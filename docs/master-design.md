# Browser Node.js Runtime — Design Document

## Mục tiêu

Chạy Node.js ecosystem hoàn chỉnh trong browser mà không cần server, không lộ cơ chế nội bộ. Output tương đương WebContainers:

- `npm install`, `npm ci`, `npm run`, `npm start`
- `child_process.spawn` / `spawnSync`
- `fs.watch()` / Vite HMR
- `http.createServer().listen(port)`
- WebSocket server
- Toàn bộ logic quan trọng ẩn trong WASM binary

---

## Nguyên lý thiết kế

### Node.js = V8 + libuv + C++ Bindings

Browser đã có V8 và event loop. Phần thiếu duy nhất là C++ native bindings — phần giao tiếp với OS. Thay vì compile toàn bộ Node.js (như WebContainers), chỉ compile C++ bindings sang WASM và replace OS syscalls bằng Web APIs.

```
Node.js layers          Approach
─────────────           ────────────────────────────────
JS stdlib               Serve từ RAM VFS, không thay đổi
V8 engine               Dùng browser V8 sẵn có
libuv event loop        Replace bằng browser event loop
C++ bindings            Compile → WASM (Emscripten)
OS syscalls             Replace bằng Web APIs
```

### 5 nguyên tắc cứng

Các nguyên tắc này được rút ra từ phân tích cross-layer deadlocks. Vi phạm bất kỳ nguyên tắc nào sẽ dẫn đến deadlock hoặc race condition không thể recover.

**Nguyên tắc 1: Main Thread chỉ giữ VFS, không bao giờ Asyncify**

Main Thread là owner duy nhất của RamVfs. Nó không fetch network, không chạy Node.js code, không Asyncify. Mọi network fetch xảy ra trong Workers. Lý do: Asyncify suspend toàn bộ WASM instance — nếu Main suspend, mọi VFS request từ các Workers đều bị block vĩnh viễn.

**Nguyên tắc 2: Mỗi Worker có một responsibility duy nhất**

```
Main Thread     → RamVfs owner, serve VFS requests, điều phối Workers
OPFS Worker     → OPFS I/O duy nhất (createSyncAccessHandle), write-through
Handler Worker  → Node.js code execution, được phép Asyncify
TCP Worker      → SAB spin loop, không Asyncify
npm Worker      → npm resolution, VFS access qua MessageChannel
Child Workers   → user scripts, VFS access qua MessageChannel
Service Worker  → HTTP proxy, Cache API, TCP port routing
```

Không Worker nào làm việc thuộc responsibility của Worker khác.

**Nguyên tắc 3: Static assets tách khỏi SW VFS proxy**

`node_bindings.wasm`, `node_stdlib/*.js`, `sw.js` được serve từ Cache API trực tiếp, SW không intercept. Lý do: phá vỡ circular dependency khi bootstrap — Main cần WASM để init, nhưng nếu WASM phải đi qua SW thì SW cần Main để serve, vòng lặp vô tận.

**Nguyên tắc 4: Write lock trước batch write**

Bất kỳ operation ghi nhiều files liên quan (npm install, build) phải acquire write lock trên path prefix. Watch events bị buffer cho đến khi lock release. Đảm bảo watchers nhận consistent state, không race condition giữa npm install và Vite HMR.

**Nguyên tắc 5: SAB communication phải có timeout**

Mọi SharedArrayBuffer spin loop phải có deadline. Nếu counterpart không respond trong thời gian quy định → throw Error, không deadlock.

---

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────────┐
│                            Browser                               │
│                                                                  │
│  Cache API                                                       │
│  ├── /runtime/node_bindings.wasm  ← SW không intercept          │
│  ├── /runtime/node_bindings.js                                   │
│  └── /runtime/node_stdlib/*.js                                   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                     Main Thread                         │    │
│  │                                                         │    │
│  │  node_bindings.wasm (VFS instance)                      │    │
│  │  ├── RamVfs      ← source of truth, KHÔNG Asyncify      │    │
│  │  └── VFS lock    ← batch write coordination             │    │
│  │                                                         │    │
│  │  JS glue: opfsWrite(path, bytes)  ← Emscripten bind     │    │
│  │           └──► MessageChannel ──► OPFS Worker           │    │
│  └───────────────┬─────────────────────────────────────────┘    │
│                  │ MessageChannel (VFS requests)                 │
│   ┌──────────────┼──────────────────────────┐                   │
│   │              │                          │                   │
│  ┌▼────────────┐ │                    ┌─────▼──────────────┐   │
│  │Handler      │ │                    │npm / Child Workers  │   │
│  │Worker       │ │                    │                     │   │
│  │• Node.js    │ │                    │• npm resolution     │   │
│  │  http server│ │                    │• user scripts       │   │
│  │• Asyncify OK│ │                    │• VFS qua MC         │   │
│  └──────┬──────┘ │                    └─────────────────────┘   │
│         │ SAB    │                                               │
│  ┌──────▼──────┐ │   ┌──────────────────────────────────┐      │
│  │TCP Worker   │ │   │         OPFS Worker               │      │
│  │• SAB spin   │ │   │  • createSyncAccessHandle()       │      │
│  │• no Asyncify│ │   │  • exclusive lock per write       │      │
│  └──────┬──────┘ │   │  • BroadcastChannel notify tabs   │      │
│         │ SAB    │   └──────────────┬───────────────────┘      │
│  ┌──────▼────────────────────────────────────────────────┐     │
│  │                   Service Worker                       │     │
│  │  • Static assets → Cache API                          │     │
│  │  • Dynamic files → postMessage → Main                 │     │
│  │  • Virtual TCP → SAB → TCP Worker → Handler Worker    │     │
│  │  • COOP/COEP header injection                         │     │
│  └───────────────────────────────────────────────────────┘     │
│                              │                                   │
│                     ┌────────▼────────┐                         │
│                     │      OPFS       │                         │
│                     │  (persistence)  │                         │
│                     └────────▲────────┘                         │
│                              │ read/write                        │
│                         OPFS Worker                              │
└──────────────────────────────────────────────────────────────────┘
```

---

## Bootstrap sequence

Thứ tự khởi động được thiết kế để tránh circular dependency giữa các thành phần.

```
Phase A — Không cần ai (Cache API + server):
  browser load index.html
  → kiểm tra crossOriginIsolated
  → nếu false: register SW → reload
  → SW inject COOP/COEP → lần sau crossOriginIsolated = true

Phase B — Main tự boot, không cần SW:
  fetch /runtime/node_bindings.wasm  ← Cache API, SW không intercept
  init WASM
  acquire tab lock (navigator.locks) ← đảm bảo single tab
  đọc OPFS → populate RamVfs        ← trực tiếp, không qua SW

Phase C — Hệ thống đầy đủ:
  Main postMessage SW: VFS_READY
  SW bắt đầu serve dynamic file requests
  Main spawn Handler Worker
  Handler Worker init Node.js runtime
  user code chạy
```

```javascript
// index.html
async function bootstrap() {
  // Phase A
  if (!crossOriginIsolated) {
    await navigator.serviceWorker.register("/sw.js");
    location.reload();
    return;
  }

  // Phase B
  await acquireTabLock(); // throw nếu tab khác đang mở
  const wasm = await WebAssembly.compileStreaming(
    fetch("/runtime/node_bindings.wasm"),
  );
  await initWasm(wasm);
  for (const { path, content } of await opfsListAll()) {
    wasmVfsPreload(path, content); // không emit events, không write-through
  }

  // Phase C
  const sw = await navigator.serviceWorker.ready;
  sw.active.postMessage({ type: "VFS_READY" });
  spawnHandlerWorker();
}

function acquireTabLock() {
  return new Promise((resolve, reject) => {
    navigator.locks.request("project_tab", { ifAvailable: true }, (lock) => {
      if (!lock) {
        reject(new Error("Project already open in another tab"));
        return;
      }
      resolve();
      return new Promise(() => {}); // giữ lock cho đến khi tab đóng
    });
  });
}
```

---

## Thành phần 1: RamVfs

RamVfs là source of truth duy nhất cho tất cả file operations. Chỉ chạy trên Main Thread. Không bao giờ được access trực tiếp từ Workers khác — mọi access đều qua MessageChannel.

### Data structure

```rust
// src/vfs_ram.rs

pub struct RamVfs {
    files:     HashMap<String, FileEntry>,
    dirs:      HashSet<String>,
    watchers:  Vec<Watcher>,
    locks:     HashMap<String, LockId>,   // prefix → lock
    event_buf: Vec<DeferredEvent>,        // buffered khi locked
    next_wid:  WatcherId,
    next_lid:  LockId,
}

struct FileEntry {
    content: Vec<u8>,
    mtime:   u64,   // ms timestamp
    mode:    u32,
}

struct Watcher {
    id:        WatcherId,
    path:      String,
    recursive: bool,
    callback:  js_sys::Function,
}

struct DeferredEvent {
    path: String,
    kind: WatchEventKind,
}
```

### Write path

Mỗi write đi qua 3 bước tuần tự:

```rust
pub fn write(&mut self, path: &str, content: Vec<u8>) -> Result<()> {
    // 1. Ghi RAM — sync, 0ms
    self.files.insert(path.to_string(), FileEntry {
        content: content.clone(),
        mtime:   now_ms(),
        mode:    0o644,
    });
    self.ensure_parent_dirs(path);

    // 2. Watch events — buffer nếu path đang bị lock
    self.maybe_emit(path, WatchEventKind::Modified);

    // 3. OPFS write-through — fire and forget, không block Main
    //    Không await — Main không bao giờ block trên I/O
    spawn_local(opfs_write(path.to_string(), content));

    Ok(())
}

fn maybe_emit(&mut self, path: &str, kind: WatchEventKind) {
    let locked = self.locks.keys().any(|p| path.starts_with(p.as_str()));
    if locked {
        self.event_buf.push(DeferredEvent { path: path.to_string(), kind });
    } else {
        self.emit_to_watchers(path, kind);
    }
}
```

### Write lock — tránh race condition với npm install

```rust
/// Acquire lock trên path prefix. Watch events trong prefix này bị buffer.
pub fn acquire_lock(&mut self, prefix: &str) -> LockId {
    let id = self.next_lid;
    self.next_lid += 1;
    self.locks.insert(prefix.to_string(), id);
    id
}

/// Release lock. Flush tất cả buffered events — đảm bảo watchers
/// nhận state nhất quán sau khi batch write hoàn tất.
pub fn release_lock(&mut self, id: LockId) {
    self.locks.retain(|_, v| *v != id);
    let events = std::mem::take(&mut self.event_buf);
    for ev in events {
        self.emit_to_watchers(&ev.path, ev.kind);
    }
}
```

### fs.watch() — 0ms latency

Hook trực tiếp vào write path. Không polling, không OPFS round-trip.

```rust
pub fn watch(&mut self, path: String, recursive: bool, cb: js_sys::Function) -> WatcherId {
    let id = self.next_wid;
    self.next_wid += 1;
    self.watchers.push(Watcher { id, path, recursive, callback: cb });
    id
}

fn emit_to_watchers(&self, path: &str, kind: WatchEventKind) {
    for w in &self.watchers {
        if self.path_matches(&w.path, path, w.recursive) {
            let ev = js_sys::Object::new();
            js_sys::Reflect::set(&ev, &"path".into(), &path.into()).ok();
            js_sys::Reflect::set(&ev, &"kind".into(), &format!("{kind:?}").into()).ok();
            w.callback.call1(&JsValue::NULL, &ev).ok();
        }
    }
}

fn path_matches(&self, watch_path: &str, changed: &str, recursive: bool) -> bool {
    if recursive { changed.starts_with(watch_path) }
    else {
        let parent = changed.rsplit_once('/').map(|(p,_)| p).unwrap_or("");
        changed == watch_path || parent == watch_path
    }
}
```

### VFS MessageChannel — serve requests từ Workers

Main thread lắng nghe VFS requests từ tất cả Workers qua MessageChannel. Dùng `Atomics.waitAsync` để không block event loop.

```javascript
// main.js

const vfsPorts = []; // MessageChannel ports từ các Workers

function registerWorkerVfsPort(port) {
  vfsPorts.push(port);
  port.onmessage = async ({ data }) => {
    switch (data.op) {
      case "read": {
        const bytes = wasmVfsRead(data.path);
        port.postMessage({ id: data.id, bytes: bytes ?? null });
        break;
      }
      case "write": {
        wasmVfsWrite(data.path, data.bytes);
        port.postMessage({ id: data.id });
        break;
      }
      case "acquire_lock": {
        const lockId = wasmVfsAcquireLock(data.prefix);
        port.postMessage({ id: data.id, lockId });
        break;
      }
      case "release_lock": {
        wasmVfsReleaseLock(data.lockId);
        port.postMessage({ id: data.id });
        break;
      }
    }
  };
}
```

### F5 restore

Main đọc OPFS và populate RamVfs trong Phase B của bootstrap. SW không tham gia vào quá trình này.

```rust
/// Preload từ OPFS: chỉ ghi RAM, không emit watch events,
/// không write-through lại OPFS.
#[wasm_bindgen]
pub fn vfs_preload(path: &str, content: &[u8]) {
    VFS.with(|v| {
        v.borrow_mut().files.insert(
            path.to_string(),
            FileEntry { content: content.to_vec(), mtime: 0, mode: 0o644 },
        );
    });
}
```

---

## Thành phần 2: OPFS Persistence Layer

OPFS chỉ làm 2 việc: nhận write-through từ RamVfs, và cung cấp data để restore RamVfs sau F5.

`FileSystemSyncAccessHandle` theo spec chỉ available trong Workers, không phải main thread. Vì vậy toàn bộ OPFS I/O chạy trong **OPFS Worker** riêng. Main gọi JS glue `opfsWrite(path, bytes)` (được Emscripten bind) → postMessage tới OPFS Worker → Worker dùng `createSyncAccessHandle` để có exclusive lock.

```javascript
// js/opfs_worker.js — dedicated Worker, KHÔNG phải main thread

const root = await navigator.storage.getDirectory();
const bc = new BroadcastChannel("opfs_sync");

async function getHandle(path, create = false) {
  const parts = path.split("/").filter(Boolean);
  let dir = root;
  for (const seg of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(seg, { create });
  }
  return dir.getFileHandle(parts.at(-1), { create });
}

self.onmessage = async ({ data }) => {
  const { op, id, path, bytes } = data;

  if (op === "write") {
    const handle = await getHandle(path, true);
    // createSyncAccessHandle = exclusive lock — OK trong Worker
    // Throw nếu tab khác đang giữ lock trên cùng file
    const sync = await handle.createSyncAccessHandle();
    try {
      sync.truncate(0);
      sync.write(bytes);
      sync.flush();
    } finally {
      sync.close();
    }
    // Notify các tab khác → invalidate RAM cache
    bc.postMessage({ type: "file_changed", path });
    self.postMessage({ id });
  } else if (op === "read") {
    const handle = await getHandle(path);
    const file = await handle.getFile();
    const content = new Uint8Array(await file.arrayBuffer());
    self.postMessage({ id, content });
  } else if (op === "list_all") {
    const results = [];
    async function walk(dir, prefix) {
      for await (const [name, handle] of dir.entries()) {
        const p = prefix ? `${prefix}/${name}` : name;
        if (handle.kind === "file") {
          results.push({
            path: p,
            content: new Uint8Array(
              await (await handle.getFile()).arrayBuffer(),
            ),
          });
        } else {
          await walk(handle, p);
        }
      }
    }
    await walk(root, "");
    self.postMessage({ id, results });
  }
};
```

```javascript
// js/opfs_bridge.js — chạy trên main thread, expose API cho WASM

const opfsWorker = new Worker("/js/opfs_worker.js");
const pending = new Map();

opfsWorker.onmessage = ({ data }) => {
  pending.get(data.id)?.(data);
  pending.delete(data.id);
};

// Các hàm này được Emscripten bind — Main gọi như JS function thường
export function opfsWrite(path, bytes) {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    pending.set(id, resolve);
    opfsWorker.postMessage({ op: "write", id, path, bytes });
  });
}

export function opfsListAll() {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    pending.set(id, ({ results }) => resolve(results));
    opfsWorker.postMessage({ op: "list_all", id });
  });
}

// Nhận notification từ tab khác → invalidate RAM cache
const bc = new BroadcastChannel("opfs_sync");
bc.onmessage = ({ data }) => {
  if (data.type === "file_changed") wasmVfsInvalidate(data.path);
};
```

Trong RamVfs (Rust), `spawn_local(opfs_write(...))` gọi JS `opfsWrite()` thông qua Emscripten bind — không gọi thẳng vào OPFS, không block Main.

---

## Thành phần 3: Service Worker

SW là thin proxy layer. Không giữ state, không giữ VFS. Hai việc chính: serve files và route Virtual TCP.

```javascript
// sw.js

const mainClients = new Map(); // clientId → client
const portBuffers = new Map(); // port → SharedArrayBuffer (TCP)

// ── Lifecycle ──────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  // Pre-cache static assets — không bao giờ serve qua VFS proxy
  event.waitUntil(
    caches.open("static-v1").then((c) =>
      c.addAll([
        "/runtime/node_bindings.wasm",
        "/runtime/node_bindings.js",
        "/runtime/node_stdlib/fs.js",
        "/runtime/node_stdlib/path.js",
        // ... tất cả stdlib
      ]),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ── Messages ────────────────────────────────────────────────────────

self.addEventListener("message", ({ data, source }) => {
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type === "VFS_READY") {
    mainClients.set(source.id, source);
  }
  if (data.type === "register_port") {
    portBuffers.set(data.port, data.buffer);
  }
  if (data.type === "vfs_response") {
    pendingVfs.get(data.requestId)?.(data.bytes);
    pendingVfs.delete(data.requestId);
  }
});

// ── Fetch routing ──────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. Static assets → Cache API, không cần Main
  if (url.pathname.startsWith("/runtime/") || url.pathname === "/sw.js") {
    event.respondWith(
      caches.match(event.request).then((r) => r ?? fetch(event.request)),
    );
    return;
  }

  // 2. COOP/COEP cho document
  if (event.request.destination === "document") {
    event.respondWith(injectIsolationHeaders(event.request));
    return;
  }

  // 3. Dynamic VFS files → forward tới Main
  if (url.pathname.startsWith("/__r__/")) {
    event.respondWith(serveVfsFile(url.pathname.slice(7), event.clientId));
    return;
  }

  // 4. Virtual TCP ports → SAB pipe
  const portMatch = url.hostname.match(/^port-(\d+)\.preview\./);
  if (portMatch) {
    const buf = portBuffers.get(parseInt(portMatch[1]));
    if (buf) {
      event.respondWith(handleVirtualTcp(event.request, buf));
      return;
    }
  }
});

// ── Helpers ────────────────────────────────────────────────────────

const pendingVfs = new Map();

async function serveVfsFile(path, clientId) {
  const client =
    mainClients.get(clientId) ?? (await self.clients.matchAll())[0];
  if (!client) return new Response("No client", { status: 503 });

  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    pendingVfs.set(requestId, (bytes) => {
      if (!bytes) {
        resolve(new Response("Not found", { status: 404 }));
        return;
      }
      const isJs =
        /\.(m?js|cjs|ts|tsx|jsx)$/.test(path) || path.startsWith("builtin/");
      resolve(
        new Response(bytes, {
          headers: {
            "Content-Type": isJs
              ? "application/javascript"
              : "application/octet-stream",
          },
        }),
      );
    });
    client.postMessage({ type: "vfs_request", requestId, path });
  });
}

async function handleVirtualTcp(request, buf) {
  if (request.headers.get("upgrade") === "websocket") {
    const { 0: client, 1: server } = new WebSocketPair();
    bridgeWebSocket(server, buf);
    return new Response(null, { status: 101, webSocket: client });
  }

  const ctrl = new Int32Array(buf);
  const data = new Uint8Array(buf);
  const reqBytes = await serializeRequest(request);

  data.set(reqBytes, 12);
  Atomics.store(ctrl, 1, reqBytes.length);
  Atomics.store(ctrl, 0, 1); // STATUS_REQUEST
  Atomics.notify(ctrl, 0);

  // Atomics.wait OK trong SW (dedicated thread)
  Atomics.wait(ctrl, 0, 1);

  const respLen = Atomics.load(ctrl, 2);
  const respBytes = data.slice(
    12 + reqBytes.length,
    12 + reqBytes.length + respLen,
  );
  Atomics.store(ctrl, 0, 0); // reset idle
  return deserializeResponse(respBytes);
}

function bridgeWebSocket(ws, buf) {
  const ctrl = new Int32Array(buf);
  const data = new Uint8Array(buf);
  ws.accept();

  ws.addEventListener("message", ({ data: msg }) => {
    const bytes =
      typeof msg === "string"
        ? new TextEncoder().encode(msg)
        : new Uint8Array(msg);
    const isText = typeof msg === "string";
    data.set(bytes, 12);
    Atomics.store(ctrl, 1, bytes.length);
    Atomics.store(ctrl, 2, isText ? 0 : 1); // msg_type
    Atomics.store(ctrl, 0, 1); // FROM_CLIENT
    Atomics.notify(ctrl, 0);
  });

  ws.addEventListener("close", () => {
    Atomics.store(ctrl, 2, 2); // CLOSE
    Atomics.store(ctrl, 0, 1);
    Atomics.notify(ctrl, 0);
  });
  (async () => {
    while (true) {
      await Atomics.waitAsync(ctrl, 0, 0).value;
      if (Atomics.load(ctrl, 0) !== 2) continue; // FROM_SERVER
      const len = Atomics.load(ctrl, 1);
      const msgType = Atomics.load(ctrl, 2);
      const bytes = data.slice(12, 12 + len);
      if (msgType === 2) {
        ws.close();
        break;
      }
      ws.send(msgType === 0 ? new TextDecoder().decode(bytes) : bytes.buffer);
      Atomics.store(ctrl, 0, 0);
      Atomics.notify(ctrl, 0);
    }
  })();
}

async function injectIsolationHeaders(request) {
  const resp = await fetch(request);
  const h = new Headers(resp.headers);
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Embedder-Policy", "require-corp");
  return new Response(resp.body, { status: resp.status, headers: h });
}
```

---

## Thành phần 4: Virtual TCP

Node.js `http.createServer().listen(port)` → map sang subdomain → SW intercept → SAB pipe → Handler Worker.

### Subdomain scheme

Browser không cho SW intercept `localhost:port`. Giải pháp: mỗi port map sang subdomain riêng.

```
listen(3000) → port-3000.preview.yourdomain.com
listen(5173) → port-5173.preview.yourdomain.com
```

SW install cho `*.preview.yourdomain.com` → intercept tất cả.

### 3-hop architecture

HTTP request đi qua 3 hop để tránh block Main Thread:

```
SW ──(SAB)──► TCP Worker ──(SAB)──► Handler Worker
                                          │
                              Node.js HTTP handler chạy ở đây
                              Asyncify OK — chỉ suspend Worker này
                                          │
              TCP Worker ◄──(SAB)─────────┘
SW ◄──(SAB)──┘
```

### SAB layout

```
SharedArrayBuffer (per port, 4MB):
  [0]   i32  status     0=idle, 1=req, 2=resp, 3=ws_client, 4=ws_server
  [1]   i32  req_len
  [2]   i32  resp_len
  [3]   i32  msg_type   (WebSocket: 0=text, 1=binary, 2=close)
  [12+] bytes req_body / resp_body / ws_message
```

### TCP Worker — spin loop không Asyncify

```javascript
// tcp_worker.js
const sw_sab = null; // SAB với SW
const hand_sab = null; // SAB với Handler Worker

self.onmessage = ({ data }) => {
  sw_sab = data.sw_sab;
  hand_sab = data.hand_sab;
  runLoop();
};

function runLoop() {
  const sw_ctrl = new Int32Array(sw_sab);
  const hand_ctrl = new Int32Array(hand_sab);

  while (true) {
    // Chờ SW gửi request
    Atomics.wait(sw_ctrl, 0, 0);
    const status = Atomics.load(sw_ctrl, 0);
    if (status !== 1) continue;

    // Copy request SW → Handler
    const req_len = Atomics.load(sw_ctrl, 1);
    new Uint8Array(hand_sab).set(new Uint8Array(sw_sab, 12, req_len), 12);
    Atomics.store(hand_ctrl, 1, req_len);
    Atomics.store(hand_ctrl, 0, 1);
    Atomics.notify(hand_ctrl, 0);

    // Chờ Handler xử lý xong (với timeout)
    const deadline = Date.now() + 30000;
    while (Atomics.load(hand_ctrl, 0) === 1) {
      if (Date.now() > deadline) {
        // Timeout → trả 503
        writeErrorResponse(sw_sab, 503);
        Atomics.store(sw_ctrl, 0, 2);
        Atomics.notify(sw_ctrl, 0);
        continue;
      }
      Atomics.wait(hand_ctrl, 0, 1, 100);
    }

    // Copy response Handler → SW
    const resp_len = Atomics.load(hand_ctrl, 2);
    new Uint8Array(sw_sab).set(
      new Uint8Array(hand_sab, 12 + req_len, resp_len),
      12 + req_len,
    );
    Atomics.store(sw_ctrl, 2, resp_len);
    Atomics.store(sw_ctrl, 0, 2);
    Atomics.notify(sw_ctrl, 0);
  }
}
```

### Handler Worker — chạy Node.js, được phép Asyncify

```javascript
// handler_worker.js
let hand_sab = null;
let vfsPort = null; // MessageChannel tới Main

self.onmessage = ({ data }) => {
  hand_sab = data.hand_sab;
  vfsPort = data.vfsPort;
  initNodeRuntime();
  runHandlerLoop();
};

function runHandlerLoop() {
  const ctrl = new Int32Array(hand_sab);

  while (true) {
    Atomics.wait(ctrl, 0, 0);
    if (Atomics.load(ctrl, 0) !== 1) continue;

    const req_len = Atomics.load(ctrl, 1);
    const request = deserializeRequest(new Uint8Array(hand_sab, 12, req_len));

    // dispatch tới user handler
    // Asyncify OK — chỉ suspend Worker này, không ảnh hưởng Main
    const response = dispatchToNodeHandler(request);
    const resp = serializeResponse(response);

    new Uint8Array(hand_sab).set(resp, 12 + req_len);
    Atomics.store(ctrl, 2, resp.length);
    Atomics.store(ctrl, 0, 2);
    Atomics.notify(ctrl, 0);
  }
}
```

### Setup flow khi Node code gọi listen()

```javascript
// main.js
function setupVirtualPort(port, userHandler) {
  const sw_sab = new SharedArrayBuffer(4 * 1024 * 1024);
  const hand_sab = new SharedArrayBuffer(4 * 1024 * 1024);
  const { port1, port2 } = new MessageChannel();

  // TCP Worker: spin loop
  const tcpWorker = new Worker("tcp_worker.js");
  tcpWorker.postMessage({ sw_sab, hand_sab });

  // Handler Worker: Node.js code
  const handlerWorker = new Worker("handler_worker.js");
  handlerWorker.postMessage({ hand_sab, vfsPort: port2 }, [port2]);

  // Main: serve VFS requests từ Handler Worker
  port1.onmessage = ({ data }) => {
    if (data.op === "read") {
      port1.postMessage({ id: data.id, bytes: wasmVfsRead(data.path) });
    } else if (data.op === "write") {
      wasmVfsWrite(data.path, data.bytes);
      port1.postMessage({ id: data.id });
    }
  };

  // Notify SW register port
  navigator.serviceWorker.controller.postMessage({
    type: "register_port",
    port,
    buffer: sw_sab,
  });
}
```

---

## Thành phần 5: child_process

`child_process.spawn` → spawn Web Worker với WASM instance riêng. VFS access qua MessageChannel về Main (không SAB để tránh deadlock với Asyncify).

### Spawn flow

```javascript
// child_process_browser.js

export function spawn(file, args, options = {}) {
  const { port1, port2 } = new MessageChannel();
  const stdin = new SharedArrayBuffer(64 * 1024);
  const stdout = new SharedArrayBuffer(1024 * 1024);
  const stderr = new SharedArrayBuffer(64 * 1024);

  const worker = new Worker("child_worker.js");
  worker.postMessage(
    { file, args, env: options.env, stdin, stdout, stderr, vfsPort: port2 },
    [port2],
  );

  // Main serve VFS requests từ child
  port1.onmessage = ({ data }) => {
    if (data.op === "read") {
      port1.postMessage({ id: data.id, bytes: wasmVfsRead(data.path) });
    } else if (data.op === "write") {
      wasmVfsWrite(data.path, data.bytes);
      port1.postMessage({ id: data.id });
    }
  };

  return new ChildProcessBridge(worker, stdin, stdout, stderr);
}

export function spawnSync(file, args, options = {}) {
  const done = new Int32Array(new SharedArrayBuffer(4));
  const stdout = new SharedArrayBuffer(1024 * 1024);
  const stderr = new SharedArrayBuffer(64 * 1024);
  const { port1, port2 } = new MessageChannel();

  const worker = new Worker("child_worker.js");
  worker.postMessage(
    { file, args, env: options.env, done, stdout, stderr, vfsPort: port2 },
    [port2],
  );

  port1.onmessage = ({ data }) => {
    if (data.op === "read") {
      port1.postMessage({ id: data.id, bytes: wasmVfsRead(data.path) });
    } else if (data.op === "write") {
      wasmVfsWrite(data.path, data.bytes);
      port1.postMessage({ id: data.id });
    }
  };

  // Block cho đến khi child xong
  Atomics.wait(done, 0, 0);

  return {
    status: done[0],
    stdout: readSab(stdout),
    stderr: readSab(stderr),
  };
}
```

### VFS access từ child — MessageChannel, không SAB spin

Dùng MessageChannel thay vì SAB để VFS request tích hợp với browser event loop của Main, tránh deadlock khi Main đang xử lý việc khác.

```javascript
// child_worker.js

let vfsPort = null;

self.onmessage = ({ data }) => {
  vfsPort = data.vfsPort;
  runScript(data.file, data.args);
};

// VFS read từ child — async, không block
async function vfsRead(path) {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    vfsPort.postMessage({ op: "read", path, id });
    const handler = ({ data }) => {
      if (data.id !== id) return;
      vfsPort.removeEventListener("message", handler);
      resolve(data.bytes);
    };
    vfsPort.addEventListener("message", handler);
  });
}

// VFS write từ child
async function vfsWrite(path, bytes) {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    vfsPort.postMessage({ op: "write", path, bytes, id });
    const handler = ({ data }) => {
      if (data.id !== id) return;
      vfsPort.removeEventListener("message", handler);
      resolve();
    };
    vfsPort.addEventListener("message", handler);
  });
}
```

---

## Thành phần 6: npm Engine

npm install không extract tarballs vào RAM hay OPFS. Chỉ lưu lockfile và tạo package stubs. Files thật được fetch lazily từ CDN khi code import.

### npm commands

| Command                          | Behaviour                         |
| -------------------------------- | --------------------------------- |
| `npm install` / `npm i`          | Resolve deps → lockfile → stubs   |
| `npm install -f`                 | Skip cache, re-resolve            |
| `npm install --legacy-peer-deps` | Bỏ qua peer dep conflicts         |
| `npm install -D`                 | Ghi vào devDependencies           |
| `npm install pkg@version`        | Install version cụ thể            |
| `npm ci`                         | Strict từ lockfile, fail nếu lệch |
| `npm run <script>`               | Chạy script trong package.json    |
| `npm start`                      | Alias `npm run start`             |
| `npm uninstall`                  | Xoá khỏi package.json + lockfile  |
| `npm update`                     | Update lên version mới nhất       |

### install vs ci

```
npm install:                    npm ci:
  có lockfile → dùng làm base    BẮT BUỘC có lockfile
  không có → resolve fresh       lockfile lệch → fail ngay
  lockfile lệch → update         xoá node_modules trước
  thêm package mới được          không update lockfile
                                  reproducible builds
```

### Semver resolution — Rust

```rust
// src/npm/semver.rs

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version { pub major: u64, pub minor: u64, pub patch: u64, pub pre: Vec<PreRelease> }

pub enum Range {
    Any,
    Exact(Version),
    Caret(Version),                   // ^1.2.3
    Tilde(Version),                   // ~1.2.3
    Gte(Version), Gt(Version),        // >=, >
    Lte(Version), Lt(Version),        // <=, <
    Hyphen(Version, Version),         // 1.2.3 - 2.3.4
    And(Box<Range>, Box<Range>),      // >=1.0 <2.0
    Or(Box<Range>, Box<Range>),       // ^1 || ^2
    Tag(String),                      // "latest", "next"
}

impl Range {
    pub fn satisfies(&self, v: &Version) -> bool {
        match self {
            Range::Any          => true,
            Range::Exact(r)     => v == r,
            Range::Caret(r)     => v >= r && (
                if r.major > 0      { v.major == r.major }
                else if r.minor > 0 { v.major == 0 && v.minor == r.minor }
                else                { v == r }
            ),
            Range::Tilde(r)     => v >= r && v.major == r.major && v.minor == r.minor,
            Range::Gte(r)       => v >= r,
            Range::Gt(r)        => v > r,
            Range::Lte(r)       => v <= r,
            Range::Lt(r)        => v < r,
            Range::Hyphen(l, h) => v >= l && v <= h,
            Range::And(l, r)    => l.satisfies(v) && r.satisfies(v),
            Range::Or(l, r)     => l.satisfies(v) || r.satisfies(v),
            Range::Tag(_)       => true,
        }
    }
}
```

### Dependency resolution — parallel fetch

```rust
// src/npm/resolver.rs

pub async fn resolve_all(
    deps: &HashMap<String, String>,
    flags: &InstallFlags,
) -> Result<LockFile> {
    let mut lock  = LockFile::new();
    let mut queue = deps.iter().map(|(n,r)| (n.clone(), r.clone())).collect::<Vec<_>>();

    while !queue.is_empty() {
        // Fetch packuments song song, max 6 concurrent
        let batch: Vec<_> = queue.drain(..queue.len().min(6)).collect();
        let results = futures::future::join_all(
            batch.iter().map(|(name, _)| fetch_packument(name))
        ).await;

        for ((name, range_str), packument) in batch.iter().zip(results) {
            if lock.has(name) { continue; }
            let packument = packument?;
            let version   = pick_version(&packument, range_str, flags)?;
            let manifest  = &packument.versions[&version];

            lock.add(name.clone(), version.clone(), manifest.dist.clone());

            for (dep, dep_range) in &manifest.dependencies {
                if !lock.has(dep) { queue.push((dep.clone(), dep_range.clone())); }
            }

            if !flags.legacy_peer_deps {
                check_peer_deps(&manifest.peer_dependencies, &lock)?;
            }
        }
    }
    Ok(lock)
}
```

### npm install flow — với write lock

```rust
// src/npm/shim.rs

async fn npm_install(args: &[String]) -> i32 {
    let flags    = InstallFlags::parse(args);
    let new_pkgs = args.iter().filter(|a| !a.starts_with('-')).cloned().collect::<Vec<_>>();

    let mut pkg_json = read_pkg_json();
    for pkg_str in &new_pkgs {
        let (name, range) = parse_pkg_arg(pkg_str);
        if flags.save_dev { pkg_json.dev_dependencies.insert(name, range); }
        else              { pkg_json.dependencies.insert(name, range); }
    }

    let lock = match resolve_all(&pkg_json.all_deps(), &flags).await {
        Ok(l)  => l,
        Err(e) => { eprintln!("npm ERR! {e}"); return 1; }
    };

    // Acquire lock trước khi ghi node_modules — buffer watch events
    let lock_id = VFS.with(|v| v.borrow_mut().acquire_lock("project/node_modules"));

    // Tạo stubs + prefetch CDN entries
    create_stubs(&lock);
    prefetch_cdn_entries(&lock).await;  // đảm bảo files có sẵn trước khi Vite đọc

    // Release lock → flush watch events → Vite nhận consistent state
    VFS.with(|v| v.borrow_mut().release_lock(lock_id));

    write_lockfile(&lock);
    write_pkg_json(&pkg_json);
    println!("added {} packages", lock.packages.len());
    0
}
```

### npm ci — strict mode

```rust
async fn npm_ci() -> i32 {
    let lock = match read_lockfile() {
        Some(l) => l,
        None    => { eprintln!("npm ERR! Missing package-lock.json\nnpm ERR! Use npm install."); return 1; }
    };

    // Fail nếu lockfile lệch package.json
    let pkg_json = read_pkg_json();
    if let Err(e) = validate_consistency(&lock, &pkg_json) {
        eprintln!("npm ERR! {e}"); return 1;
    }

    // Xoá node_modules cũ
    let lock_id = VFS.with(|v| v.borrow_mut().acquire_lock("project/node_modules"));
    VFS.with(|v| v.borrow_mut().remove_prefix("project/node_modules"));

    // Tạo stubs từ lockfile (không resolve lại)
    create_stubs(&lock);
    prefetch_cdn_entries(&lock).await;

    VFS.with(|v| v.borrow_mut().release_lock(lock_id));
    println!("added {} packages", lock.packages.len());
    0
}
```

---

## Thành phần 7: CDN Resolver

Khi code import một package, CDN resolver fetch file thật lazily và cache vào RamVfs.

### File resolution flow

```
import 'vite'
        │
        ▼
1. Đọc lockfile → vite@6.0.0
        │
        ▼
2. Check RamVfs cache
   hit → serve ngay (0ms)
        │ miss
        ▼
3. Fetch package.json từ unpkg
   GET https://unpkg.com/vite@6.0.0/package.json
        │
        ▼
4. Resolve exports field → ./dist/node/index.cjs
        │
        ▼
5. Fetch file
   GET https://unpkg.com/vite@6.0.0/dist/node/index.cjs
        │
        ▼
6. CJS → ESM nếu cần
        │
        ▼
7. Cache vào RamVfs qua MessageChannel → Main
        │
        ▼
8. Serve
```

### Exports field resolution

```rust
// src/cdn/resolver.rs

fn resolve_exports(exports: &ExportsField, subpath: &str) -> Result<String> {
    const CONDITIONS: &[&str] = &["import", "browser", "module", "default"];

    match exports {
        ExportsField::String(s) if subpath == "." => Ok(s.clone()),
        ExportsField::Map(map) => {
            // Exact match
            if let Some(target) = map.get(subpath) {
                return resolve_condition(target, CONDITIONS);
            }
            // Pattern match: "./features/*" → "./features/auth"
            for (pattern, target) in map {
                if let Some(wildcard) = match_pattern(pattern, subpath) {
                    let r = resolve_condition(target, CONDITIONS)?;
                    return Ok(r.replace('*', &wildcard));
                }
            }
            Err(Error::ExportNotFound(subpath.to_string()))
        }
        _ => Err(Error::InvalidExports),
    }
}

fn resolve_condition(target: &ExportsTarget, conds: &[&str]) -> Result<String> {
    match target {
        ExportsTarget::String(s)     => Ok(s.clone()),
        ExportsTarget::Conditions(m) => {
            for c in conds {
                if let Some(t) = m.get(*c) { return resolve_condition(t, conds); }
            }
            Err(Error::NoMatchingCondition)
        }
        ExportsTarget::Array(arr) => {
            arr.iter().find_map(|t| resolve_condition(t, conds).ok())
               .ok_or(Error::NoMatchingCondition)
        }
    }
}
```

### readFileSync + CDN fetch — giải quyết sync/async mismatch

`require()` / `readFileSync` là synchronous nhưng CDN fetch là async. Giải pháp: Emscripten Asyncify suspend WASM stack của Handler Worker trong khi fetch, resume khi xong. Main Thread không bị ảnh hưởng vì đây là Handler Worker riêng.

```c
// patches/node_file_browser.cc

EM_ASYNC_JS(void*, cdn_fetch_sync, (const char* url), {
  // Trông sync với WASM nhưng thật ra là async với browser
  // Emscripten Asyncify suspend Handler Worker stack
  const resp  = await fetch(UTF8ToString(url))
  const bytes = new Uint8Array(await resp.arrayBuffer())
  const ptr   = Module._malloc(bytes.length + 4)
  Module.HEAPU32[ptr >> 2] = bytes.length
  Module.HEAPU8.set(bytes, ptr + 4)
  return ptr
})

char* node_readFileSync(const char* path) {
    // Tier 1: RamVfs cache
    if (auto bytes = vfs_read_from_main(path)) return bytes;

    // Tier 2: CDN fetch (Asyncify suspend Handler Worker)
    std::string url = cdn_url_for(path);
    void* result    = cdn_fetch_sync(url.c_str());

    // Cache vào RamVfs qua MessageChannel (async, không block)
    uint32_t len = *(uint32_t*)result;
    send_to_main_write(path, (char*)result + 4, len);

    return (char*)result + 4;
}
```

### CORS — fetch qua SW

npm registry và một số CDN không allow CORS. SW fetch không bị restriction này:

```javascript
// sw.js
async function fetchForNpm(url) {
  // SW fetch cross-origin không bị CORS block như main thread
  const resp = await fetch(url, {
    headers: { Accept: "application/vnd.npm.install-v1+json" },
  });
  return resp.json();
}
```

---

## Thành phần 8: Node.js C++ Bindings

### Patch map

| File gốc              | Patch                        | Backend                      |
| --------------------- | ---------------------------- | ---------------------------- |
| `node_file.cc`        | `node_file_browser.cc`       | RamVfs qua MessageChannel    |
| `node_file_async.cc`  | `node_file_async_browser.cc` | RamVfs qua MessageChannel    |
| `node_crypto.cc`      | `node_crypto_browser.cc`     | WebCrypto API                |
| `node_process.cc`     | `node_process_browser.cc`    | Stub (env, argv, exit)       |
| `node_os.cc`          | `node_os_browser.cc`         | Stub (platform=linux)        |
| `node_worker.cc`      | `node_worker_browser.cc`     | Web Workers                  |
| `spawn_sync.cc`       | `spawn_sync_browser.cc`      | Web Worker + SAB done signal |
| `tcp_wrap.cc`         | `tcp_wrap_browser.cc`        | Virtual TCP setup            |
| `node_timer_wrap.cc`  | `node_timer_browser.cc`      | browser setTimeout           |
| `node_buffer.cc`      | Giữ nguyên                   | Pure C++                     |
| `node_url.cc`         | Giữ nguyên                   | Pure C++                     |
| `node_http_parser.cc` | Giữ nguyên                   | Pure C++                     |

### Build script

```bash
#!/bin/bash
set -e

NODE_SRC=./node-src
PATCHES=./patches
OUT=./dist/runtime

# Apply patches
for f in $PATCHES/*.cc; do
  cp $f $NODE_SRC/src/$(basename $f | sed 's/_browser//')
done

# Compile
emcc \
  $NODE_SRC/src/node_file.cc \
  $NODE_SRC/src/node_file_async.cc \
  $NODE_SRC/src/node_crypto.cc \
  $NODE_SRC/src/node_buffer.cc \
  $NODE_SRC/src/node_process.cc \
  $NODE_SRC/src/node_os.cc \
  $NODE_SRC/src/node_url.cc \
  $NODE_SRC/src/node_worker.cc \
  $NODE_SRC/src/spawn_sync.cc \
  $NODE_SRC/src/tcp_wrap.cc \
  $NODE_SRC/src/node_http_parser.cc \
  $NODE_SRC/src/node_timer_wrap.cc \
  -I$NODE_SRC/src \
  -I$NODE_SRC/deps/uv/include \
  -I$NODE_SRC/deps/v8/include \
  -s ENVIRONMENT=web \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=NodeBindings \
  -s ASYNCIFY=1 \
  -s ASYNCIFY_IGNORE_INDIRECT=1 \
  -s SHARED_MEMORY=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=134217728 \
  -s PTHREAD_POOL_SIZE=8 \
  --js-library js/opfs_driver.js \
  --js-library js/sw_bridge.js \
  --bind \
  -O3 \
  --closure 1 \
  -o $OUT/node_bindings.js

# Optimize + strip symbols
wasm-opt -Oz --strip-debug --strip-producers \
  $OUT/node_bindings.wasm -o $OUT/node_bindings.wasm

# Copy node stdlib (unmodified)
cp -r $NODE_SRC/lib/* $OUT/node_stdlib/
```

---

## Bảo mật

### File classification

```
/runtime/node_bindings.wasm   Serve từ Cache API, SW không intercept
/runtime/node_stdlib/*.js     Serve từ Cache API, SW không intercept
/sw.js                        Serve từ server trực tiếp

/__r__/project/src/**         SW proxy → Main → RamVfs
/__r__/builtin/**             SW serve embedded stubs
/__r__/project/node_modules/  SW CDN resolver
port-*.preview.domain/**      SW Virtual TCP routing
```

### Obfuscation

```bash
# 1. Strip WASM symbols (đã có trong build script)
wasm-opt --strip-debug --strip-producers ...

# 2. Obfuscate JS glue
npx javascript-obfuscator dist/runtime/sw.js \
  --output dist/runtime/sw.js \
  --compact true \
  --control-flow-flattening true \
  --string-array true \
  --string-array-encoding rc4 \
  --self-defending true

# 3. Random VFS prefix mỗi build
export VFS_PREFIX=$(openssl rand -hex 4)
# /__r__/ → /_a3f9b2c1_/
```

---

## Cấu trúc thư mục

```
browser-node/
├── patches/                       # Node.js C++ patches
│   ├── node_file_browser.cc
│   ├── node_file_async_browser.cc
│   ├── node_crypto_browser.cc
│   ├── node_process_browser.cc
│   ├── node_os_browser.cc
│   ├── node_worker_browser.cc
│   ├── spawn_sync_browser.cc
│   ├── tcp_wrap_browser.cc
│   └── node_timer_browser.cc
├── src/                           # Rust core (compile → node_bindings.wasm)
│   ├── lib.rs
│   ├── vfs_ram.rs
│   ├── npm/
│   │   ├── mod.rs
│   │   ├── semver.rs
│   │   ├── resolver.rs
│   │   ├── lockfile.rs
│   │   └── shim.rs
│   └── cdn/
│       ├── mod.rs
│       └── resolver.rs
├── js/                            # JS (thin, obfuscated khi deploy)
│   ├── opfs_worker.js             # OPFS I/O Worker (createSyncAccessHandle)
│   ├── opfs_bridge.js             # Main-side bridge → OPFS Worker (Emscripten bind)
│   ├── sw_bridge.js               # Main → SW communication
│   ├── tcp_worker.js              # SAB spin loop Worker
│   ├── handler_worker.js          # Node.js HTTP handler Worker (Asyncify OK)
│   ├── child_worker.js            # child_process Worker
│   └── child_process_browser.js   # spawn/spawnSync API
├── sw/
│   └── sw.js
├── build/
│   ├── build.sh
│   └── Cargo.toml
└── dist/runtime/                  # Output — serve trực tiếp từ server
    ├── node_bindings.wasm
    ├── node_bindings.js
    └── node_stdlib/
```

---

## So sánh với WebContainers

|                   | WebContainers        | Thiết kế này        |
| ----------------- | -------------------- | ------------------- |
| Approach          | Compile full Node.js | Chỉ C++ bindings    |
| Bundle size       | ~40 MB               | ~10–15 MB           |
| child_process     | Có                   | Có (Web Workers)    |
| fs.watch() / HMR  | Có                   | Có (0ms hook)       |
| http server       | Có                   | Có (subdomain TCP)  |
| npm install / ci  | Có                   | Có                  |
| F5 restore        | Có                   | Có (OPFS)           |
| node_modules size | Unlimited            | Virtual — không ghi |
| Code ẩn           | Không                | Có (WASM)           |
| Phụ thuộc         | Stackblitz           | Không               |

---

## Giới hạn

| Feature                | Lý do                                 |
| ---------------------- | ------------------------------------- |
| Native addons (.node)  | Không có dynamic linker trong browser |
| Raw TCP client         | Browser block hoàn toàn               |
| Unix domain sockets    | Không tồn tại                         |
| Python/Ruby/Go         | Cần compile runtime riêng             |
| npm postinstall binary | Binary không chạy được                |

---

## Roadmap

```
Phase 1 — RamVfs + fs.watch() (2 tuần)
  □ RamVfs với write lock
  □ fs.watch() hook 0ms
  □ OPFS write-through + exclusive lock
  □ F5 restore: OPFS → RAM trong bootstrap Phase B
  □ VFS MessageChannel từ Workers về Main
  □ Vite HMR end-to-end

Phase 2 — Virtual TCP + Handler Worker (3 tuần)
  □ Subdomain-per-port scheme
  □ SAB pipe layout + timeout
  □ TCP Worker spin loop
  □ Handler Worker + Asyncify
  □ SW routing
  □ WebSocket bridge protocol
  □ http.createServer() end-to-end

Phase 3 — child_process (2 tuần)
  □ spawn() + spawnSync()
  □ stdin/stdout/stderr SAB pipes
  □ VFS MessageChannel cho child
  □ IPC: process.send() / process.on('message')

Phase 4 — npm Engine (3 tuần)
  □ Semver parser + resolver
  □ Parallel packument fetch
  □ Lockfile generate/validate
  □ Virtual node_modules stubs
  □ npm install / ci / run / update
  □ Write lock integration

Phase 5 — CDN Resolver (2 tuần)
  □ Exports field resolution
  □ Lazy fetch + RamVfs cache
  □ CJS → ESM conversion
  □ Prefetch sau npm install

Phase 6 — Node.js C++ Bindings (4 tuần)
  □ Patch từng file
  □ Emscripten build pipeline
  □ Integration test end-to-end

Phase 7 — Hardening (2 tuần)
  □ Random VFS prefix
  □ Obfuscate JS + WASM strip
  □ Firefox/Safari test
  □ Performance benchmark
```

---

## Implementation Notes

Các điểm dưới đây không thay đổi thiết kế nhưng cần lưu ý khi implement để tránh sai lệch giữa mô tả và thực tế.

### 1. `createSyncAccessHandle` chỉ dùng được trong Worker

`FileSystemSyncAccessHandle` theo spec chỉ available trong dedicated/shared Workers, không phải main thread. Nếu `opfs_write` được gọi từ Main Thread phải dùng `createWritable()` (async) thay thế.

Giải pháp: tách OPFS I/O vào một **OPFS Worker** riêng. Main giao tiếp qua MessageChannel. OPFS Worker dùng `createSyncAccessHandle` bình thường.

```
Main Thread
  write(path, bytes)
        │ MessageChannel
        ▼
OPFS Worker
  createSyncAccessHandle() ← OK trong Worker
  sync.write(bytes)
  sync.flush()
  sync.close()
  bc.postMessage({ type: 'file_changed', path })
```

```javascript
// js/opfs_worker.js — chạy trong dedicated Worker

const root = await navigator.storage.getDirectory();
const bc = new BroadcastChannel("opfs_sync");

self.onmessage = async ({ data }) => {
  const { op, id, path, bytes } = data;

  if (op === "write") {
    const handle = await getHandle(path, true);
    const sync = await handle.createSyncAccessHandle();
    try {
      sync.truncate(0);
      sync.write(bytes);
      sync.flush();
    } finally {
      sync.close();
    }
    bc.postMessage({ type: "file_changed", path });
    self.postMessage({ id });
  } else if (op === "read") {
    const handle = await getHandle(path);
    const file = await handle.getFile();
    const content = new Uint8Array(await file.arrayBuffer());
    self.postMessage({ id, content });
  } else if (op === "list_all") {
    const results = [];
    await walk(root, "", results);
    self.postMessage({ id, results });
  }
};
```

```javascript
// main.js — giao tiếp với OPFS Worker

const opfsWorker = new Worker("/js/opfs_worker.js");
const pending = new Map();

opfsWorker.onmessage = ({ data }) => {
  pending.get(data.id)?.(data);
  pending.delete(data.id);
};

function opfsWrite(path, bytes) {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    pending.set(id, resolve);
    opfsWorker.postMessage({ op: "write", id, path, bytes });
  });
}

function opfsListAll() {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    pending.set(id, ({ results }) => resolve(results));
    opfsWorker.postMessage({ op: "list_all", id });
  });
}
```

Trong RamVfs, `spawn_local(opfs_write(...))` được thay bằng gọi qua JS glue về OPFS Worker.

---

### 2. `dispatchToNodeHandler` là async khi Asyncify active

Khi Handler Worker build với `-s ASYNCIFY=1`, mọi hàm WASM có thể suspend stack. `dispatchToNodeHandler(request)` thực chất trả về một Promise từ góc nhìn JS — Emscripten wrap kết quả.

Handler loop cần await kết quả:

```javascript
// handler_worker.js — phiên bản đúng

async function runHandlerLoop() {
  const ctrl = new Int32Array(hand_sab);

  while (true) {
    Atomics.wait(ctrl, 0, 0);
    if (Atomics.load(ctrl, 0) !== 1) continue;

    const req_len = Atomics.load(ctrl, 1);
    const request = deserializeRequest(new Uint8Array(hand_sab, 12, req_len));

    // await — Asyncify có thể suspend WASM stack ở đây
    const response = await dispatchToNodeHandler(request);

    const resp = serializeResponse(response);
    new Uint8Array(hand_sab).set(resp, 12 + req_len);
    Atomics.store(ctrl, 2, resp.length);
    Atomics.store(ctrl, 0, 2);
    Atomics.notify(ctrl, 0);
  }
}

// Không gọi runHandlerLoop() — gọi await
runHandlerLoop(); // fire and forget, loop chạy nền
```

Lưu ý: `Atomics.wait` trong Worker là synchronous blocking — gọi trước `await` là OK vì tại thời điểm đó WASM chưa suspend. Vấn đề chỉ xảy ra nếu gọi `Atomics.wait` sau khi đã vào async context — tránh pattern đó.

---

### 3. Path normalization trong `path_matches`

`started_with` thuần túy có edge case với trailing slash:

```
watch_path = "/project"
changed    = "/project-backup/file.ts"
→ "/project-backup/file.ts".starts_with("/project") → TRUE (sai)
```

Cần normalize trước khi so sánh:

```rust
fn path_matches(&self, watch_path: &str, changed: &str, recursive: bool) -> bool {
    // Normalize: đảm bảo so sánh theo path segment, không phải string prefix
    let watch_norm   = watch_path.trim_end_matches('/');
    let changed_norm = changed.trim_end_matches('/');

    if recursive {
        // changed phải là watch_path hoặc nằm trong watch_path/
        changed_norm == watch_norm
            || changed_norm.starts_with(&format!("{watch_norm}/"))
    } else {
        // Non-recursive: chỉ match file trực tiếp hoặc file trong dir đó
        let parent = changed_norm.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
        changed_norm == watch_norm || parent == watch_norm
    }
}
```

---

### 4. npm Worker không có VFS.with() — dùng MessageChannel

Code Rust trong phần npm Engine (`VFS.with(...)`, `create_stubs(...)`, `write_lockfile(...)`) mô tả **logic**, không phải nơi chạy. Trong thực tế npm chạy trong npm Worker có WASM instance riêng, không share VFS với Main.

Mọi VFS operation từ npm Worker phải đi qua MessageChannel về Main:

```javascript
// npm_worker.js — thực tế

async function npmInstall(args) {
  const flags = parseFlags(args);
  const pkgJson = await vfsRead("project/package.json").then(JSON.parse);

  // Resolve deps (logic thuần, không cần VFS)
  const lock = await resolveAll(pkgJson.dependencies, flags);

  // Acquire lock trên Main trước khi ghi node_modules
  const lockId = await vfsAcquireLock("project/node_modules");

  // Ghi stubs qua MessageChannel
  for (const [name, entry] of Object.entries(lock.packages)) {
    await vfsWrite(
      `project/node_modules/${name}/package.json`,
      JSON.stringify({ name, version: entry.version, main: "index.js" }),
    );
  }

  // Prefetch CDN entries
  await prefetchCdnEntries(lock);

  // Release lock → Main flush watch events
  await vfsReleaseLock(lockId);

  // Ghi lockfile + package.json
  await vfsWrite("project/package-lock.json", JSON.stringify(lock, null, 2));
  await vfsWrite("project/package.json", JSON.stringify(pkgJson, null, 2));
}
```

Tương ứng, Main cần handle thêm 2 VFS ops:

```javascript
// main.js — VFS MessageChannel handler

port.onmessage = async ({ data }) => {
  switch (data.op) {
    case "read":
      port.postMessage({ id: data.id, bytes: wasmVfsRead(data.path) });
      break;
    case "write":
      wasmVfsWrite(data.path, data.bytes);
      port.postMessage({ id: data.id });
      break;
    case "acquire_lock":
      port.postMessage({
        id: data.id,
        lockId: wasmVfsAcquireLock(data.prefix),
      });
      break;
    case "release_lock":
      wasmVfsReleaseLock(data.lockId);
      port.postMessage({ id: data.id });
      break;
  }
};
```
