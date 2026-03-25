# Polyfill Analysis — Node.js Compatibility Layer

Phân tích toàn bộ các polyfill trong `node/polyfills/` theo ba tiêu chí:
1. Hoạt động đúng chưa?
2. Đủ chưa?
3. Vấn đề sẽ xảy ra trong thực tế?

---

## Tổng quan nhanh

| Module | Trạng thái | Mức độ vấn đề |
|--------|-----------|--------------|
| `fs.ts` | Partial | Trung bình — FD stateless, sync stubs throw |
| `process.ts` | Partial | Trung bình — hrtime sai epoch, chdir sai |
| `net.ts` | Stub | **Nghiêm trọng** — Socket.connect() dead |
| `http.ts` | Partial | Trung bình — no streaming |
| `crypto.ts` | Partial | **Nghiêm trọng** — cipher/sign là no-op |
| `child_process.ts` | Partial | Trung bình — stdin dead, kill() no-op |
| `stream.ts` | Tốt | Minor — thiếu API mới |
| `events.ts` | Tốt | Minor — async iterator không support |
| `worker_threads.ts` | Partial | Trung bình — sync channel fail |
| `vm.ts` | Partial | Minor — no isolation |
| `os.ts` | Tốt | Không có vấn đề thực tế |
| `tls.ts` | Stub thuần | Silently fail |
| `cluster.ts` | Stub thuần | Fork pattern không work |
| `dgram.ts` | Stub thuần | UDP không work |
| `dns.ts` | Stub thuần | Lookup không work |
| `http2.ts` | Stub thuần | HTTP/2 không work |

---

## fs.ts

### Những gì hoạt động đúng
- Toàn bộ async API: `readFile`, `writeFile`, `appendFile`, `unlink`, `mkdir`, `rmdir`, `rm`, `rename`, `copyFile`, `readdir`, `stat`, `lstat`, `exists`, `watch`
- `fs.promises.*` — mirror của async API
- syncCache mechanism cho môi trường không có SAB sync
- `readFileSync` với VFS SAB-backed

### Vấn đề

**FD không track position (nghiêm trọng với Go WASM / esbuild):**
```
fs.open(path, 'r', (err, fd) => {
  fs.read(fd, buf, 0, 512, null, cb);   // đọc từ 0
  fs.read(fd, buf, 0, 512, null, cb);   // vẫn đọc từ 0 (!)
})
```
`fdMap` chỉ lưu `path`, không lưu `position`. Mỗi `read()` luôn đọc từ offset được truyền vào, không advance cursor. esbuild WASM dùng pattern này để đọc file tuần tự.

**write() là read-modify-write không atomic:**
Mỗi `fs.write()` phải đọc toàn bộ file trước rồi mới ghi lại. Nếu 2 write đồng thời, race condition làm mất data.

**Sync stubs throw vô điều kiện:**
- `lstatSync` — throw `"not supported in browser"` luôn
- `unlinkSync` — throw luôn
- `rmdirSync` — throw luôn
- `writeFileSync` — throw nếu không có syncCache

**mkdirSync nuốt lỗi im lặng:**
```ts
vfs.mkdir(resolved, { recursive }).catch(() => {});  // lỗi bị bỏ qua
```
Caller không biết mkdir thất bại.

**statSync false positive directory:**
Khi có syncCache và path không phải file, nó scan prefix để tìm "có file con không". Nếu syncCache trùng prefix một cách tình cờ, trả về `isDirectory: true` sai.

**readdirSync thiếu VFS entries:**
Chỉ scan syncCache. File trong VFS nhưng không qua syncCache (vd: node_modules) không hiện.

**readdir withFileTypes là O(N) round trips:**
Gọi `vfs.stat()` N lần tuần tự thay vì một batch call.

---

## net.ts

### Những gì hoạt động đúng
- API surface đủ để import không crash
- `Server.listen()` emit `"listening"` đúng lúc
- `isIP`, `isIPv4`, `isIPv6` hoạt động đúng

### Vấn đề nghiêm trọng

**Socket.connect() là complete no-op:**
```ts
connect(_portOrOptions, _hostOrCb, _cb): this {
  return this;  // không làm gì
}
```
Không có bridge tới SAB TCP system (`js/tcp_worker.ts`). Toàn bộ package dùng TCP trực tiếp (mysql, redis, pg, socket.io với TCP backend) sẽ nhận Socket trống, không bao giờ emit `"connect"`, không nhận data.

**Server không emit "connection":**
`Server.listen()` chỉ set `listening = true` và emit `"listening"`. Không có cơ chế nào để Service Worker route request vào `Server` và tạo Socket cho connection. `createServer(cb)` callback không bao giờ được gọi từ net module.

**Socket.write() là no-op:**
Trả `true` nhưng data bị drop silently.

**Thiếu IPC pipe support:**
Không có `server.listen('/tmp/sock.ipc')` hay pipe-based socket.

---

## http.ts

### Những gì hoạt động đúng
- `createServer` → `HttpServer` → gọi `__setupVirtualPort` đúng cách
- `request`/`get` → `ClientRequest` → `fetch()` — hoạt động cho outbound requests
- `IncomingMessage`, `ServerResponse` có đủ API surface
- `writeHead`, `setHeader`, `getHeader`, `removeHeader` đúng

### Vấn đề

**IncomingMessage không stream body:**
```ts
resume(): this {
  queueMicrotask(() => this.emit("end"));  // emit end ngay, không có data
  return this;
}
```
Nếu server handler đọc `req` body qua `req.on('data', ...)`, không có data nào được emit. `body-parser`, `multer`, express body parsing đều dựa vào pattern này.

**ClientRequest không stream response:**
```ts
const buf = Buffer.from(await res.arrayBuffer());
queueMicrotask(() => {
  msg.emit("data", buf);  // toàn bộ body trong 1 chunk
  msg.emit("end");
});
```
Response lớn (file download, video stream) bị buffer hết vào RAM trước khi xử lý.

**STATUS_CODES thiếu:**
Thiếu: 206 (Partial Content), 408 (Request Timeout), 409 (Conflict), 410 (Gone), 413 (Payload Too Large), 422 (Unprocessable Entity), 451, 499, 502, 504, 507...

**Agent là stub:**
Không có connection pooling, keep-alive, socket reuse. Packages phụ thuộc vào `http.globalAgent.maxSockets` để throttle connections sẽ không có effect.

**Không support WebSocket upgrade:**
`req.socket.upgrade` pattern không work.

---

## process.ts

### Những gì hoạt động đúng
- `stdout`/`stderr`/`stdin` streams với TTY support
- `env`, `argv`, `platform`, `arch`, `versions`
- `nextTick` → `queueMicrotask` (semantics đúng)
- `exit()` → throw `ProcessExitError` (caught bởi runner)
- TTY cursor control: `cursorTo`, `moveCursor`, `clearLine`, `clearScreenDown`

### Vấn đề

**hrtime() sai epoch:**
```ts
hrtime = (prev?) => {
  const nowMs = performance.now();  // ms từ page load, KHÔNG phải Unix epoch
  const sec = Math.floor(nowMs / 1000);
  // ...
}
```
`performance.now()` trả milliseconds kể từ khi page load, không phải Unix timestamp. Code nào dùng `hrtime()` để tính duration tuyệt đối hoặc compare với wall clock sẽ sai. Nên dùng `Date.now()` cho seconds component.

**chdir() với absolute path:**
```ts
chdir = (dir: string): void => {
  this._cwd = PathUtils.join(this._cwd, dir);  // sai nếu dir là absolute
};
```
Nếu `dir = "/home/user/project"`, `join("/current", "/home/user/project")` có thể không resolve đúng. Cần `PathUtils.resolve` hoặc check `isAbsolute`.

**ProcessStream.write() corrupt binary:**
```ts
const str = String(s).replace(/\r?\n/g, "\r\n");
```
Nếu `s` là `Uint8Array` chứa byte `0x0A` (LF), cast sang string sẽ có thể corrupt data trước khi replace.

**stdin không nhận input:**
`process.stdin` là `ProcessStream(false, 0, () => {})` — write callback là no-op. Code đọc stdin sẽ không bao giờ nhận data từ terminal.

**memoryUsage() trả 0:**
Một số profiler/tool check memory (clinic.js, autocannon) dùng `process.memoryUsage()`. Trả 0 có thể gây logic lỗi hoặc chia cho 0.

---

## child_process.ts

### Những gì hoạt động đúng
- `spawn('node', args)` → `__runNode` — pipe subprocess node đúng
- `spawn('npm', args)` / `spawn('npx', args)` → route qua node
- `exec` với `node script.js` pattern cơ bản

### Vấn đề

**ChildProcess.stdin là dead stub:**
```ts
stdin = {
  write: (_chunk, _enc, cb) => { cb?.(); return true; },  // data bị drop
  end: (_chunk, _enc, cb) => { cb?.(); },
};
```
Code spawn process rồi pipe data vào stdin sẽ mất toàn bộ input.

**kill() không dừng được process:**
```ts
kill(_signal?: string): boolean {
  this.killed = true;
  return false;  // __runNode promise vẫn chạy
}
```
Không có AbortController hay cancellation signal truyền vào `__runNode`.

**exec() parse args ngây thơ:**
```ts
const match = /^node\s+(.+)$/.exec(cmd.trim());
const scriptArgs = match[1]!.split(/\s+/);  // split bằng whitespace
```
`exec('node "my file.js" --arg "hello world"')` sẽ parse sai — split theo space không handle quoted args.

**execFile() luôn error:**
```ts
execFile(...) {
  cb?.(new Error("execFile: not supported in browser"), "", "");
}
```
Nhiều npm packages (nodemon, ts-node) dùng `execFile` thay vì `exec`.

**fork() luôn exit 1:**
Cluster patterns, Jest worker processes dùng `fork()` — tất cả fail.

**stdout/stderr không phải Readable stream:**
`proc.stdout` là `EventEmitter` thuần, không implement `pipe()`, `read()`, `readable` property. Code dùng `proc.stdout.pipe(someWritable)` sẽ crash.

---

## crypto.ts

### Những gì hoạt động đúng
- `createHash` với sha1/sha256/sha512/sha384/sha224/md5 — dùng `@noble/hashes`, kết quả đúng
- `createHmac` với sha1/sha256/sha512/md5 — đúng
- `randomBytes` — Web Crypto CSPRNG
- `randomFillSync`/`randomFill` — đúng
- `timingSafeEqual` — constant-time comparison đúng
- `pbkdf2` async — Web Crypto PBKDF2 đúng
- `randomUUID` — Web Crypto

### Vấn đề nghiêm trọng

**pbkdf2Sync trả random bytes:**
```ts
const pbkdf2Sync = (..., keylen, ...) => {
  return randomBytes(keylen);  // RANDOM! Không phải PBKDF2!
};
```
Code dùng `pbkdf2Sync` để hash password (bcrypt alternatives, passport-local) sẽ tạo ra hash khác nhau mỗi lần → không bao giờ verify được password.

**scryptSync cũng trả random bytes:**
Tương tự pbkdf2Sync. Argon2/scrypt-based auth hoàn toàn broken.

**createCipheriv/createDecipheriv là no-op:**
```ts
createCipheriv: (_alg, _key, _iv) => ({
  update: (data) => Buffer.from(data),  // trả data gốc, KHÔNG encrypt
  final: () => Buffer.alloc(0),
});
```
Code encrypt data (session secrets, database credentials, API keys) sẽ lưu **plaintext** với giả định đã encrypt. **Đây là security vulnerability.**

**createSign/createVerify là stub:**
```ts
createSign: (_algorithm) => ({
  update: () => {},
  sign: () => Buffer.alloc(0),  // empty signature
});
createVerify: (_algorithm) => ({
  verify: () => false,  // luôn reject
});
```
JWT signing với RS256/ES256/PS256 sẽ tạo signature rỗng. JWT verify luôn trả false.

**generateKeyPair trả buffer rỗng:**
```ts
generateKeyPairSync: () => ({
  publicKey: Buffer.alloc(0),
  privateKey: Buffer.alloc(0),
}),
```
TLS cert generation, OAuth key generation, SSH key generation đều broken.

**publicEncrypt/privateDecrypt là identity:**
```ts
publicEncrypt: (_key, buffer) => buffer,  // không encrypt
privateDecrypt: (_key, buffer) => buffer, // không decrypt
```

**randomInt dùng Math.random():**
```ts
randomInt: (min, maxOrCb, cb?) => {
  const n = min + Math.floor(Math.random() * (max - min));  // NOT cryptographic
}
```
Nên dùng `crypto.getRandomValues()`.

**createHash fallback là djb2:**
Nếu algorithm không được nhận ra, fallback sang djb2 hash — không cryptographic, collisions nhiều.

---

## stream.ts

### Nhận xét
Wrap `readable-stream` v4 — library đầy đủ, battle-tested, implement đúng Node.js stream semantics. Đây là polyfill tốt nhất trong bộ.

### Thiếu API Node.js 16+
- `stream.compose()`
- `stream.addAbortSignal()`
- `stream.getDefaultHighWaterMark()`
- `ReadableStream`/`WritableStream` adapter (Node 17+)

---

## events.ts

### Những gì hoạt động đúng
eventemitter3 là implementation đầy đủ: `on`, `once`, `off`, `emit`, `removeAllListeners`, `listenerCount`, `eventNames`.

### Thiếu
- `events.on(emitter, 'event')` — async iterator, throw thay vì support
- `getEventListeners()` luôn trả `[]`
- `EventEmitter.once()` static không handle error event cleanup đúng nếu error emit trước event

---

## worker_threads.ts

### Những gì hoạt động đúng
- `Worker` → `__spawnWorkerThreadsWorker` — spawn real Web Worker
- `MessageChannel`/`MessagePort` — delegate browser native
- `isMainThread`, `parentPort`, `workerData`, `threadId` — dynamic getters

### Vấn đề
- `receiveMessageOnPort()` luôn trả `null` — synchronous channel patterns (dùng trong Atomics.wait loops) không work
- `SHARE_ENV` là Symbol mới mỗi lần module được load — không consistent khi compare
- Worker terminate không drain pending messages
- Không có `BroadcastChannel` export (Node 18+)

---

## vm.ts

### Những gì hoạt động đúng
- `Script`, `runInThisContext`, `runInNewContext`, `runInContext`, `compileFunction` đều hoạt động
- Fallback từ expression eval sang statement eval là robust

### Vấn đề
**Không có isolation:**
Code trong vm chạy trong cùng realm, có thể access và modify `globalThis`.

**Sandbox mutations không reflect ra ngoài:**
```ts
const sandbox = { x: 1 };
vm.runInNewContext('x = 42', sandbox);
console.log(sandbox.x);  // vẫn là 1, không phải 42
```
Node.js thực sự sync sandbox object sau khi run. Polyfill này không làm vậy.

**createContext trả object mới:**
```ts
function createContext(sandbox = {}) {
  return Object.assign(Object.create(null), sandbox);  // copy, không phải reference
}
```
`isContext(vm.createContext(obj))` có thể trả true cho bất kỳ object nào.

---

## Các Stubs thuần túy

### tls.ts
Trả `{}` cho mọi thứ. Bất kỳ package nào cần TLS socket thực (mysql2 với SSL, redis với TLS) sẽ silently fail hoặc crash khi gọi method trên empty object.

### cluster.ts / dgram.ts / dns.ts / http2.ts / inspector.ts / repl.ts
Chưa phân tích chi tiết nhưng nhiều khả năng là stubs tương tự.

---

## Tổng kết Rủi ro theo Loại Package

| Loại package | Polyfill bị ảnh hưởng | Kết quả |
|-------------|----------------------|---------|
| Express/Fastify app | http (inbound) | Work nếu không read body |
| Body parsing (body-parser, multer) | http IncomingMessage streaming | Body rỗng |
| Database clients (mysql2, pg, redis) | net.Socket.connect() | Silent fail |
| JWT / crypto (jsonwebtoken, bcrypt) | crypto sign/verify/pbkdf2Sync | Wrong results hoặc empty |
| Cluster / worker farms | cluster, child_process.fork() | Fail |
| File watchers (chokidar, nodemon) | fs.watch() | Work |
| Package managers (npm) | fs, child_process.spawn('node') | Work |
| Test runners (Jest, Vitest) | vm, child_process | Partial |
| HTTP clients (axios, got, node-fetch) | http.ClientRequest | Work (no streaming) |
| SSH/TLS clients | tls, net | Fail |

---

## Kế hoạch Viết lại

Xem `POLYFILL_REWRITE_PLAN.md`.
