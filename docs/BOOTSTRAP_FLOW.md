# Bootstrap & Runtime Flow Design

Tài liệu này mô tả toàn bộ luồng khởi động khi chạy `npm run dev` và chuỗi sự kiện xảy ra trong browser cho đến khi user code thực thi được bên trong runtime Node.js giả lập.

---

## 1. `npm run dev` — Vite Startup

**File:** `vite.config.ts`

Vite khởi động với ba cấu hình quan trọng:

### 1.1 COOP/COEP Headers

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Bắt buộc để `SharedArrayBuffer` hoạt động. Nếu thiếu, trang reload ngay sau khi kiểm tra `crossOriginIsolated === false` (trong `js/main.ts:bootstrap()`).

### 1.2 `/pkg` Proxy

```
/pkg/* → http://localhost:4873  (npm proxy server)
```

Mọi request fetch package (node_modules) đều đi qua proxy server local thay vì registry npm trực tiếp.

### 1.3 Middleware `.js` → `.ts` Fallback

Custom middleware `js-to-ts-fallback` (lines 35–69) cho phép browser import `./foo.js` nhưng Vite serve `./foo.ts` thực sự — không cần build step trong dev mode.

Ngoài ra, `/sw.js` được set header `Cache-Control: no-store` để Service Worker luôn nhận bản mới nhất khi update.

---

## 2. Browser Page Load

**Entry point:** `index.html` → `<script type="module" src="/js/app.ts">` (line 225)

### Cấu trúc HTML

```
┌─────────────────────────────────┐
│ Titlebar (tab bar)              │
├─────────────────────────────────┤
│ Preview iframe (top pane)       │
│  ← url: /__port__/<port>/       │
├─────────────────────────────────┤
│ xterm.js terminal (bottom pane) │
└─────────────────────────────────┘
```

---

## 3. Application Bootstrap

**File:** `js/app.ts` — `init()` (lines 346–646)

```
init()
  ├─ tạo terminal tạm thời (hiển thị progress)
  ├─ gọi bootstrap() với timeout 5 giây   ← js/main.ts
  ├─ (success) initUbuntuStructure()       ← tạo thư mục /home /tmp /etc ...
  ├─ load /sample_vite.json vào VFS (nếu có)
  ├─ tạo Shell + NodeRunner
  ├─ wireInput()                           ← kết nối keyboard → terminal
  └─ lắng nghe sự kiện "port-registered" → cập nhật preview dropdown
```

---

## 4. Core Bootstrap

**File:** `js/main.ts` — `bootstrap()` (lines 454–657)

Đây là bước quan trọng nhất — khởi tạo toàn bộ infrastructure.

### Bước 4.1 — Service Worker Registration

```typescript
const reg = await navigator.serviceWorker.register("/sw.js", {
  updateViaCache: "none",
});
await navigator.serviceWorker.ready;
```

- Nếu có SW đang chờ (`waiting`), gửi `SKIP_WAITING` để activate ngay.
- Nếu `crossOriginIsolated === false`, reload trang (COOP/COEP chưa áp dụng).

### Bước 4.2 — Tab Lock

```typescript
await acquireTabLock(); // Navigator.locks API
```

Dùng exclusive lock để chặn mở project trong nhiều tab đồng thời. Nếu tab khác đang giữ lock, tab mới bị block.

### Bước 4.3 — OPFS Worker Init

```typescript
initOpfsBridge(new URL("./opfs_worker.ts", import.meta.url));
```

Spawn `opfs_worker.ts` trong một Worker riêng. Worker này quản lý Origin Private File System — lớp persistence để khôi phục file giữa các session.

### Bước 4.4 — VFS Initialization

```typescript
try {
  const wasm = await initWasmVfs();  // load vfs_ram.js (Rust → WASM)
  // self-check: write, read, delete
  vfs = ok ? wasm : new RamVfs(...);
} catch {
  vfs = new RamVfs(...);  // JS fallback
}
```

`initWasmVfs()` (`js/vfs_wasm.ts`):

- Load `/runtime/vfs_ram.js` (compiled từ `src/vfs_ram.rs`)
- Chạy self-check: write/read/delete một file test
- Nếu pass → dùng WASM VFS; nếu fail → fallback về `RamVfs` (pure JS)

**Rust source:** `src/vfs_ram.rs`, `src/lock.rs`, `src/watcher.rs`

### Bước 4.5 — OPFS Preload

```typescript
const results = await opfsListAll(); // timeout 3 giây
for (const { path, content } of results) {
  vfs.preload(path, content);
}
```

Đọc toàn bộ file đã persist từ OPFS và nạp vào VFS in-memory → khôi phục trạng thái session trước.

### Bước 4.6 — VFS Write Interception

Wrap `vfs.write()` để:

- Ghi async vào OPFS (persistence)
- Broadcast qua `BroadcastChannel` để sync giữa các tab (nếu có)

### Bước 4.7 — Notify Service Worker

```typescript
sw.active.postMessage({ type: "VFS_READY" });
```

SW chờ signal này trước khi serve VFS file requests. Trước khi nhận được, SW trả lỗi 503.

### Bước 4.8 — CDN Proxy Setup

```typescript
const cdnProxy = createCdnVfsProxy(getVfsRead, vfs.write);
```

Khi browser request một file node_module chưa có trong VFS, `cdnProxy` fetch từ `/pkg/...` (→ npm proxy) rồi ghi vào VFS.

### Bước 4.9 — VFS Request Handler

SW gửi `vfs_request` message đến main thread mỗi khi cần đọc file từ VFS:

```
SW → main thread: { type: "vfs_request", path }
main thread → SW: { type: "vfs_response", body, headers }
```

Main thread xử lý:

1. Serve built-in ESM stubs (e.g. `builtin/fs`, `builtin/path`)
2. Serve file từ VFS
3. Nếu là JS/TS: chạy `rewriteBareSpecifiersInModule()` (đổi `import "express"` → `import "/__r__/node_modules/express/..."`)
4. Cache kết quả rewrite trong `vfsRewriteCache` Map

### Bước 4.10 — esbuild WASM Preload

```typescript
await preloadEsbuildWasm();
```

Preload esbuild WASM để transform ESM → CJS tại runtime (tránh cold-start delay khi chạy lệnh đầu tiên).

### Kết quả bootstrap()

```typescript
return {
  vfs,
  VFS_PREFIX, // e.g. "__r__"
  createServer,
  setupVirtualPort,
  registerWorkerVfsPort,
};
```

---

## 5. Shell & Terminal

**File:** `js/app.ts` — `wireInput()` (lines 175–337)

Sau bootstrap, terminal được kết nối với Shell:

| Phím        | Action                                          |
| ----------- | ----------------------------------------------- |
| `Enter`     | `shell.execute(cmd)`                            |
| `Ctrl+C`    | `terminateWorkerInSlot()` — kill Node.js worker |
| `Tab`       | `shell.complete()` — autocomplete               |
| `↑` / `↓`   | History navigation                              |
| `Backspace` | Xóa ký tự                                       |

**Shell** (`js/shell/shell.ts`):

- Built-in commands (ls, cat, cd, mkdir, rm, ...) — `js/shell/commands.ts`
- `node <file>` → gọi `createNodeRunner()` — `js/run_node.ts`

---

## 6. Node.js Execution — `node main.js`

**File:** `js/run_node.ts` — `createNodeRunner()` (lines 20–397)

### Bước 6.1 — Tạo VFS Port

```typescript
const { port1, port2 } = new MessageChannel();
registerWorkerVfsPort(port1); // main thread serve VFS requests
// port2 → gửi cho Worker
```

### Bước 6.2 — Spawn Worker

```typescript
new Worker("./worker_threads_runner.ts", { type: "module" });
```

Worker nhận `port2` (VFS), cwd, args, env, entryFile.

### Bước 6.3 — node/cli.ts `runNode()` (lines 32–190)

Trong worker:

```
runNode(args, terminal, vfs)
  ├─ parse args: --version | --help | -e <code> | <file>
  ├─ resolve entry file path trong VFS
  ├─ tạo ProcessPolyfill (process.env, process.argv, process.cwd...)
  ├─ tạo module system:
  │   ├─ ModuleResolver    (resolve require() specifiers)
  │   ├─ ModuleCache       (cache loaded modules)
  │   ├─ CJSLoader         (execute CommonJS modules)
  │   └─ builtins          (fs, http, net, child_process, ...)
  ├─ preloadEsbuildWasm()
  └─ loader.run(entryFile, cwd)
      ├─ load module source từ VFS
      ├─ transform ESM → CJS via esbuild (nếu cần)
      ├─ resolve dependencies recursively
      └─ execute trong context với polyfilled globals
```

**Node version hardcoded:** `v20.11.0` (line ~50 trong `node/cli.ts`)

---

## 7. Virtual HTTP Server

Khi user code gọi `require('http').createServer().listen(5173)`:

### Bước 7.1 — http polyfill nhận `listen(port, handler)`

Gọi `__setupVirtualPort(port, handler)` — hook được inject vào context trong `runNode()`.

### Bước 7.2 — `setupVirtualPort()` (js/main.ts, lines 343–439)

```typescript
// 1. Tạo 2 SharedArrayBuffer (4MB mỗi cái)
const swSab = new SharedArrayBuffer(4 * 1024 * 1024); // SW ↔ TCP Worker
const handSab = new SharedArrayBuffer(4 * 1024 * 1024); // TCP Worker ↔ Handler Worker

// 2. Spawn TCP Worker
const tcpWorker = new Worker("./tcp_worker.ts");
tcpWorker.postMessage({ sw_sab: swSab, hand_sab: handSab });

// 3. Spawn Handler Worker
const handlerWorker = new Worker("./handler_worker.ts");
handlerWorker.postMessage({ hand_sab: handSab, mainPort: port2, port });

// 4. Gửi swSab lên Service Worker
sendPortToSw(port, swSab);

// 5. Emit "port-registered" event (app.ts nhận → cập nhật preview URL)
```

### Bước 7.3 — Luồng HTTP Request

```
Browser                  Service Worker        TCP Worker         Handler Worker
   │                          │                    │                    │
   │  fetch(/__port__/5173/)  │                    │                    │
   ├─────────────────────────>│                    │                    │
   │                          │ serialize request  │                    │
   │                          │ copy → swSab       │                    │
   │                          │ Atomics.notify()   │                    │
   │                          │─ ─ ─ ─ ─ ─ ─ ─ ─>│                    │
   │                          │                    │ copy swSab→handSab │
   │                          │                    │ Atomics.notify()   │
   │                          │                    │─ ─ ─ ─ ─ ─ ─ ─ ─>│
   │                          │                    │                    │ deserialize
   │                          │                    │                    │ gọi handler
   │                          │                    │                    │ serialize resp
   │                          │                    │<─ ─ ─ ─ ─ ─ ─ ─ ─│
   │                          │<─ ─ ─ ─ ─ ─ ─ ─ ─ │                    │
   │                          │ deserialize resp   │                    │
   │<─────────────────────────│                    │                    │
   │   Response(200, body)    │                    │                    │
```

### SAB Control Layout (12 bytes header)

```
ctrl[0]: status  (0 = idle, 1 = request ready, 2 = response ready)
ctrl[1]: request length (bytes)
ctrl[2]: response length (bytes)
data[12..]: payload bytes
```

TCP Worker và Handler Worker đều chạy **infinite spin loop** dùng `Atomics.wait()` với timeout 30 giây để tránh deadlock.

---

## 8. Service Worker (`sw/sw.js`)

### Install

Pre-cache toàn bộ static assets (JS, HTML, WASM). Gọi `skipWaiting()` để activate ngay.

### Activate

`clients.claim()` — nhận control ngay lập tức, không đợi page refresh.

### Message Handler

| Message type    | Action                                        |
| --------------- | --------------------------------------------- |
| `SKIP_WAITING`  | Force activate SW mới                         |
| `VFS_READY`     | Đánh dấu client ID sẵn sàng nhận VFS requests |
| `register_port` | Lưu `swSab` cho port số X                     |
| `vfs_response`  | Resolve pending VFS promise                   |

### Fetch Handler

| URL pattern                     | Action                            |
| ------------------------------- | --------------------------------- |
| `/runtime/*`, `/sw.js`, `/js/*` | Cache-first (static assets)       |
| `/__port__/<port>/*`            | Virtual TCP handler               |
| `/__r__/*` hoặc `/__xxxx__/*`   | Gửi `vfs_request` lên main thread |
| Khác                            | Network pass-through              |

---

## 9. npm Proxy Server (`proxy-server/index.js`)

Chạy trên port `4873` (hoặc qua `PKG_PROXY_URL`).

```
Request: GET /express@4.18.2/index.js

1. Parse: pkg="express", version="4.18.2", file="index.js"
2. Kiểm tra cache: .pkg-cache/express/4.18.2/.extracted ?
   - Chưa có → fetch tarball từ npm registry → extract → đánh dấu .extracted
   - Đã có   → đọc trực tiếp từ disk
3. Serve file content
```

`extracting` Map ngăn download song song cùng một package (deduplication).

---

## 10. OPFS Worker (`js/opfs_worker.ts`)

Chạy trong Worker riêng, sử dụng `FileSystemSyncAccessHandle` (synchronous I/O):

| Message    | Action                                                   |
| ---------- | -------------------------------------------------------- |
| `write`    | Queue writes per-path, atomic write qua SyncAccessHandle |
| `read`     | Đọc file từ OPFS directory                               |
| `list_all` | Walk toàn bộ OPFS directory tree                         |
| `delete`   | Xóa file khỏi OPFS                                       |

Broadcast `file_changed` event qua `BroadcastChannel` khi file thay đổi (để sync giữa tabs).

---

## 11. Toàn bộ Luồng — Sơ đồ Tổng Hợp

```
npm run dev
  └─ Vite khởi động (COOP/COEP headers, /pkg proxy, .ts middleware)

Browser mở http://localhost:5173
  └─ index.html load /js/app.ts

app.ts: init()
  └─ main.ts: bootstrap()
       ├─ SW register (/sw.js)
       ├─ Tab lock (Navigator.locks)
       ├─ OPFS Worker spawn
       ├─ VFS init: WASM (Rust) → fallback JS RamVfs
       ├─ OPFS preload (khôi phục session)
       ├─ VFS write interception (persist to OPFS)
       ├─ SW notify: VFS_READY
       ├─ CDN proxy setup
       ├─ VFS request handler (main thread ↔ SW)
       └─ esbuild WASM preload

Shell ready, terminal wired

User: "node server.js"
  └─ shell.execute() → createNodeRunner()
       ├─ Tạo VFS MessageChannel → registerWorkerVfsPort()
       └─ Spawn worker_threads_runner.ts Worker
            └─ node/cli.ts: runNode()
                 ├─ ProcessPolyfill, ModuleSystem, builtins
                 ├─ esbuild WASM preload
                 └─ loader.run("server.js")
                      ├─ load source từ VFS
                      ├─ transform ESM→CJS (esbuild)
                      └─ execute

User code: require('http').createServer(handler).listen(5173)
  └─ http polyfill → __setupVirtualPort(5173, handler)
       └─ setupVirtualPort()
            ├─ Tạo swSab (4MB) + handSab (4MB)
            ├─ Spawn TCP Worker (swSab, handSab)
            ├─ Spawn Handler Worker (handSab, mainPort)
            ├─ Send swSab → Service Worker
            └─ Emit "port-registered"

Browser fetch /__port__/5173/
  └─ SW intercepts → serialize → SAB → TCP Worker → Handler Worker
       └─ call user handler → serialize response → SAB → SW → Response
```

---

## 12. Key Files Reference

| File                      | Role                                               |
| ------------------------- | -------------------------------------------------- |
| `index.html:225`          | Entry point, script import                         |
| `js/app.ts:346`           | `init()` — UI bootstrap, terminal wiring           |
| `js/main.ts:454`          | `bootstrap()` — VFS, SW, WASM init                 |
| `js/main.ts:343`          | `setupVirtualPort()` — spawn workers cho HTTP port |
| `js/vfs_wasm.ts`          | Load và init WASM VFS                              |
| `js/vfs_ram.ts`           | JS RamVfs fallback                                 |
| `js/opfs_bridge.ts`       | OPFS persistence bridge                            |
| `js/opfs_worker.ts`       | OPFS Worker (SyncAccessHandle)                     |
| `js/tcp_worker.ts:21`     | TCP spinloop: SW ↔ Handler                         |
| `js/handler_worker.ts:48` | Handler spinloop: TCP ↔ Main thread                |
| `js/run_node.ts:20`       | `createNodeRunner()` — spawn node Worker           |
| `node/cli.ts:32`          | `runNode()` — Node.js runtime entry                |
| `sw/sw.js:74`             | Fetch handler (VFS + virtual TCP routing)          |
| `proxy-server/index.js`   | npm package cache/proxy server                     |
| `vite.config.ts`          | Dev server config (COOP/COEP, proxy, middleware)   |
