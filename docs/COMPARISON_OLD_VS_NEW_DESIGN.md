# So sánh Code cũ (webcontainer) vs Tài liệu Thiết kế mới (master-design.md)

> Tài liệu phân tích các layer cần rework, layer có thể tái sử dụng, và những phần code cũ đã cover nhưng thiết kế mới chưa đề cập.

---

## Góc nhìn: Code cũ chỉ là demo tính khả thi

Code cũ (`webcontainer`) chủ yếu chứng minh ý tưởng hoạt động được:
- Có VFS, shell, npm install, node chạy script — nhưng phần lớn là stub hoặc kiến trúc khác hoàn toàn so với thiết kế mới.

**Kết luận thực tế:** Chỉ có **Shell** là layer có thể tái sử dụng thực sự. Các phần khác — VFS, npm, Node runtime, persistence, HTTP — đều viết mới theo thiết kế WASM/Rust/OPFS/CDN.

| Phần | Tái sử dụng? | Lý do |
|------|--------------|-------|
| **Shell** (parser, commands, plugin) | Có | Là lớp UI: nhận input, parse, dispatch. Chỉ cần adapter gọi API mới (WASM) thay vì VFS/npm cũ |
| VFS | Không | Cấu trúc khác (Inode → HashMap), backend khác (IDB → OPFS), viết trong Rust |
| npm | Không | Paradigm khác (extract → virtual stubs + CDN) |
| Node runtime | Không | Polyfills → C++ compile WASM |
| child_process, HTTP | Không | Cũ là stub, mới triển khai thật |
| Server | Bỏ | Thiết kế mới dùng CDN, không cần server |

Các mục "có thể tham khảo" (semver logic, exports resolution, path utils) — đó là **port/rewrite**, không phải reuse code. Có thể đọc để hiểu edge cases rồi viết lại trong Rust.

---

## Tổng quan kiến trúc

| Thành phần | Code cũ | Thiết kế mới |
|------------|---------|--------------|
| VFS | VirtualFS + Inode tree, Memory/IDB backend | RamVfs (HashMap), OPFS write-through |
| Persistence | IndexedDB | OPFS |
| HTTP Server | Stub (không thật sự listen) | Virtual TCP (subdomain-per-port, SAB) |
| child_process | Stub (throw not supported) | Web Worker + spawnSync + Cross-worker VFS |
| Node runtime | JS polyfills + CJS loader + iframe | Node.js C++ bindings → WASM |
| npm | Tarball download + extract to VFS | Virtual node_modules stubs + CDN lazy fetch |
| node_modules | Full VFS hoặc server-backed (HTTP) | Virtual stubs, fetch từ unpkg khi import |
| Module resolution | ModuleResolver (TS) | CDN resolver (Rust) |
| Service Worker | Không có | sw.js: F5 restore, VFS serve, port routing |

---

## 1. Các layer cần rework hoàn toàn

### 1.1 RAM VFS (vfs/core + backends)

**Lý do:** Khác biệt cơ bản về cấu trúc dữ liệu và luồng xử lý.

| Tiêu chí | Code cũ | Thiết kế mới |
|----------|---------|--------------|
| Cấu trúc | Inode tree (Map\<ino, Inode\>), traverse path | HashMap path → FileEntry, flat |
| Backend | StorageBackend abstraction (Memory, IDB) | RAM primary, OPFS chỉ write-through async |
| API | Async (readFile, writeFile...) | Sync trong WASM, Rust |
| Watch | WatchSystem.emit() gọi sau write | emit_change() ngay trong write path (0ms) |
| Sync API | readFileSync chỉ với MemoryBackend | VFS nằm trong WASM, sync native |

**Đề xuất:** Viết mới hoàn toàn theo `vfs_ram.rs`. Logic `PathUtils`, `WatchSystem.matches` có thể tham khảo nhưng cấu trúc khác.

---

### 1.2 OPFS Persistence

**Lý do:** Code cũ dùng IndexedDB, không có OPFS.

- `vfs/backends/idb.ts`: Lưu Inode serialized vào IDB
- Thiết kế mới: OPFS (Origin Private File System) với `getDirectoryHandle`, `createWritable`, `getFile`, `arrayBuffer`
- OPFS nhanh hơn IDB, có sync access trong Worker

**Đề xuất:** Viết mới `js/opfs_driver.js` theo spec. Không dùng được idb.ts.

---

### 1.3 Virtual TCP (HTTP Server thật)

**Lý do:** Code cũ `http.ts` polyfill chỉ là stub:
- `listen()` gọi `queueMicrotask` emit `listening` — không có server thật
- Không có subdomain-per-port, không có SAB pipe, không có SW intercept

**Đề xuất:** Viết mới toàn bộ:
- Rust: `virtual_tcp.rs` (run_port_loop, SAB protocol)
- JS: SW fetch handler cho `port-*.preview.domain`
- Layout SAB: status, req_len, resp_len, body

---

### 1.4 child_process

**Lý do:** Code cũ `child_process.ts` là stub throw "not supported". Thiết kế mới cần:
- Web Worker per process
- spawnSync với Atomics.wait
- stdin/stdout/stderr qua SAB
- Cross-worker VFS (child đọc/ghi VFS của main qua SAB channel)

**Đề xuất:** Viết mới. Có thể tham khảo:
- `runtime/process-manager.ts` — spawn Worker, track PID (logic tương tự nhưng protocol khác)
- `vfs/sync/sync-bridge.ts` — SAB encode/decode pattern

---

### 1.5 Node.js C++ Bindings → WASM

**Lý do:** Code cũ dùng JS polyfills (fs, process, http, ...). Thiết kế mới compile Node C++ source sang WASM qua Emscripten.

- Polyfills cũ: `node/polyfills/*` — không dùng
- Patch map mới: `node_file_browser.cc`, `node_crypto_browser.cc`, `tcp_wrap_browser.cc`, ...
- Build: emcc + ASYNCIFY + SHARED_MEMORY

**Đề xuất:** Viết mới hoàn toàn. Docs `build-node-wasm-guide.md`, `patching-node-wasm-guide.md` có thể tham khảo.

---

### 1.6 npm Engine (core logic)

**Lý do:** Paradigm khác:
- Cũ: Tải tarball → extract toàn bộ vào VFS (hoặc server extract, browser fetch)
- Mới: Resolve → tạo virtual stubs (package.json + placeholder index.js) → fetch file thật từ CDN khi import (lazy)

| Thành phần | Code cũ | Thiết kế mới |
|------------|---------|--------------|
| Resolution | `resolver/index.ts`, `semver.ts` | Rust resolver, semver.rs |
| Storage | Tarball extract to VFS | Stub only, không extract |
| Fetch | TarballDownloader | CDN (unpkg) khi cần |
| Lockfile | LockfileReader/Writer | Lockfile trong Rust |
| npm ci | Không có | Có (strict, fail nếu lockfile lệch) |

**Đề xuất:** Viết mới npm engine trong Rust. Logic semver (`^`, `~`, exact) có thể port từ `npm/registry/semver.ts` sang Rust.

---

### 1.7 Service Worker

**Lý do:** Code cũ không có SW.

Thiết kế mới cần sw.js để:
- F5 restore: OPFS → RAM preload
- Serve VFS files (`/__r__/path`)
- Intercept Virtual TCP (`port-*.preview`)
- COOP/COEP injection cho document

**Đề xuất:** Viết mới `sw/sw.js`.

---

## 2. Shell — layer duy nhất tái sử dụng được

**File cũ:** `shell/parser.ts`, `shell/commands.ts`, `shell/shell.ts`

Shell là lớp UI: user gõ lệnh → parse → dispatch → hiển thị output. Kiến trúc này không phụ thuộc backend.

**Reuse được:**
- `parseCommand` / `parseCommandChain` — cú pháp shell (pipe, redirect, chain)
- CommandRegistry, plugin pattern
- Builtin names (ls, cd, pwd, cat, mkdir, rm...)

**Cần adapter:** Mỗi command gọi API mới: VFS qua WASM binding, npm qua `npm_main`, node/script qua spawn mới. Shell chỉ cần nhận handler mới — interface đổi, flow giữ nguyên.

---

## 3. Phần khác — tham khảo khi port, không reuse code

### 3.1 Exports resolution (package.json exports field)

**File cũ:** `node/module-system/resolver.ts` — `resolveExports()`, `tryResolvePackageSubpath()`

- Conditions: import, browser, default — Pattern: `./features/*`
- Thiết kế mới: `cdn_resolver.rs` — logic tương tự, port sang Rust

**Các phần khác (semver, path, watch, CJS→ESM, lockfile, SyncBridge, ProcessManager):** Đều là **port/rewrite**, không reuse. Có thể đọc code cũ để nắm edge cases rồi viết mới trong Rust. Protocol mới (Virtual TCP, Cross-worker VFS) khác — viết mới sạch hơn là copy pattern cũ.

---

## 4. Code cũ đã cover nhưng thiết kế mới chưa đề cập

### 4.1 Server-backed node_modules (HybridFileSource)

**Code cũ:** 
- `server/` — Express API: POST /api/install, GET /api/packages
- `node/file-source/hybrid.ts` — đọc project từ VFS, node_modules từ server HTTP
- `docs/server-backed_node_modules_v2.plan.md`

**Thiết kế mới:** Dùng CDN (unpkg) lazy fetch, không có server-backed.

**Gợi ý:** Nếu deploy trong mạng nội bộ / offline, có thể cần mode fallback: server local cache packages thay cho CDN. Thiết kế mới nên bổ sung optional "custom package server" nếu cần.

---

### 4.2 Mount system (MountTable)

**Code cũ:** `vfs/core/mount.ts` — MountPoint, MountTable, resolve(path) → backend + relativePath

- Layout: `/` → Memory, `/project` → IDB, `/tmp` → Memory
- Thiết kế mới: Chỉ có RamVfs + OPFS, không đề cập mount nhiều backend

**Gợi ý:** Với kiến trúc mới đơn giản (1 RAM VFS + OPFS), mount có thể không cần. Nếu sau này cần nhiều workspace hoặc sandbox riêng, có thể thêm.

---

### 4.3 Stub packages (optional deps)

**Code cũ:** `node/module-system/stub-packages.ts`

- source-map-support, postcss, lightningcss, rollup, fsevents, bufferutil, utf-8-validate
- getStubExports / getStubContentsForBundle — trả về stub khi package không cài

**Thiết kế mới:** Không đề cập. Một số package có optional native deps (ws → bufferutil) hoặc platform-specific (fsevents).

**Gợi ý:** Bổ sung danh sách stub packages và logic stub vào CDN resolver hoặc transform layer.

---

### 4.4 Bare specifier rewrite (es-module-lexer)

**Code cũ:** `node/transform/bare-specifier-rewrite.ts`

- Dùng es-module-lexer parse ESM, rewrite `import "vite"` → `/__wc__/node_modules/vite/...`
- Tránh regex, xử lý đúng trong string literals, comments

**Thiết kế mới:** CDN resolver resolve khi import — không nói rõ cơ chế rewrite specifier trong source. Có thể resolve tại runtime (loader) thay vì rewrite.

**Gợi ý:** Nếu dùng import maps hoặc loader resolve trực tiếp, có thể không cần rewrite. Cần làm rõ trong thiết kế.

---

### 4.5 Alias (esbuild → esbuild-wasm)

**Code cũ:** `resolver.ts` — BROWSER_ALIAS: `esbuild` → `esbuild-wasm`

**Thiết kế mới:** Không đề cập alias cho browser-specific packages.

**Gợi ý:** Bổ sung alias map trong resolver cho các package có bản wasm riêng.

---

### 4.6 Install gate (block execution khi đang npm install)

**Code cũ:** `npm/install-gate.ts`, `HybridFileSource` — `await installGate.wait()` trước khi đọc node_modules

**Thiết kế mới:** Virtual node_modules + CDN fetch. Khi `npm install` chưa xong, stubs chưa có — cần cơ chế tương tự để tránh race.

**Gợi ý:** Có thể dùng lockfile + "installing" flag. Khi request tới stub chưa có version, đợi hoặc retry.

---

### 4.7 Content-type cho file serve

**Code cũ:** `server/content-type.ts` — map extension → MIME type cho GET /api/packages

**Thiết kế mới:** `serveVfs` trả `application/javascript` cho `.js/.mjs/.cjs/.ts/...`, `application/octet-stream` cho còn lại.

**Gợi ý:** Logic tương tự, có thể mở rộng Content-Type mapping nếu cần (e.g. `.wasm`, `.css`, `.json`).

---

### 4.8 Session lifecycle và cleanup

**Code cũ:** `server/cleanup.ts` — touchSession, deleteSession, startCleanupCron (xoá session cũ theo thời gian)

**Thiết kế mới:** Không có server, không có session. OPFS per-origin, F5 restore.

**Gợi ý:** Trong browser-only, không cần session cleanup. Nếu có multi-tab hoặc multi-user trong cùng origin, cần strategy (e.g. prefix per tab).

---

### 4.9 Regex flag /v polyfill

**Code cũ:** `docs/bug-regex-flag-v-polyfill.md` — polyfill cho regex `v` flag (set notation) trên runtime cũ

**Thiết kế mới:** Không đề cập.

**Gợi ý:** Kiểm tra target browser support. Nếu cần hỗ trợ Safari/Firefox cũ, có thể cần polyfill.

---

### 4.10 Vite bare specifier bug workaround

**Code cũ:** `docs/VITE_CONFIG_BARE_SPECIFIER_BUG.md`, `esbuild-vfs-plugin.ts` — workaround cho Vite resolve bare specifiers

**Thiết kế mới:** Không đề cập Vite-specific.

**Gợi ý:** Nếu chạy Vite trong container, cần đảm bảo config resolve tương thích. Có thể bổ sung vào docs.

---

### 4.11 Nhiều Node polyfills chi tiết

**Code cũ:** `node/polyfills/` — tty, readline, zlib, string_decoder, dns, http2, tls, inspector, v8, stream, events, ...

**Thiết kế mới:** Chỉ liệt kê patch cho file/async, crypto, process, os, worker, spawn, tcp, timer. Một số module (dns, tls, http2) không nhắc.

**Gợi ý:** Node C++ bindings khi compile sẽ include hoặc stub. Cần rà soát từng builtin: cái nào patch, cái nào giữ nguyên, cái nào stub.

---

## 5. Bảng tổng kết

| Layer | Rework | Reuse? | Ghi chú |
|-------|--------|--------|---------|
| RAM VFS | Hoàn toàn | Không | Viết mới Rust |
| OPFS | Hoàn toàn (mới) | Không | Chưa có trong code cũ |
| Virtual TCP | Hoàn toàn (mới) | Không | HTTP cũ là stub |
| child_process | Hoàn toàn | Không | Cũ throw "not supported" |
| Node C++ WASM | Hoàn toàn | Không | Thay toàn bộ polyfills |
| npm Engine | Hoàn toàn | Không | Paradigm khác |
| CDN Resolver | Phần lớn mới | Không | Port logic exports |
| Service Worker | Hoàn toàn (mới) | Không | Chưa có |
| **Shell** | Adapter handlers | **Có** | Parser, commands, plugin — gọi API mới |

---

## 6. Đề xuất bổ sung vào thiết kế mới

1. **Stub packages**: Danh sách optional deps cần stub (fsevents, bufferutil, utf-8-validate, ...)
2. **Alias map**: `esbuild` → `esbuild-wasm` và tương tự
3. **Install/concurrency gate**: Tránh đọc stub khi npm install chưa xong
4. **Optional server-backed mode**: Fallback khi không dùng CDN (offline / nội bộ)
5. **Chi tiết Node builtins**: Bảng đầy đủ: patch / stub / giữ nguyên

---

*Tài liệu tạo từ so sánh `webcontainer` (src, server, docs) với `master-design.md`*
