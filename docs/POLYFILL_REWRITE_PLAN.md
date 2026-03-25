# Polyfill Rewrite Plan

Kế hoạch viết lại các polyfill theo thứ tự ưu tiên.

---

## Status

| Phase | Module | Trạng thái | Nội dung |
|-------|--------|-----------|---------|
| 1 | `fs.ts` | ✅ Done | FD position tracking, lstatSync, unlinkSync, rmdirSync, mkdirSync |
| 1 | `process.ts` | ✅ Done | hrtime() fix epoch, chdir() fix absolute path |
| 1 | `crypto.ts` | ✅ Done | pbkdf2Sync throw, scrypt fallback, randomInt CSPRNG, createCipheriv AES async, createSign/Verify SubtleCrypto, generateKeyPair WebCrypto, publicEncrypt throw |
| 2 | `http.ts` | ✅ Done | IncomingMessage body streaming, ClientRequest chunk streaming, STATUS_CODES đầy đủ, METHODS đầy đủ, ServerResponse._getBody() |
| 2 | `child_process.ts` | ✅ Done | stdin queue/waiter pattern, kill() AbortController, exec tokenizer cho quoted args, execFile route node/npm |
| 3 | `events.ts` | ✅ Done | events.on() async iterator, getEventListeners() thực |
| 3 | `vm.ts` | ✅ Done | runInNewContext dùng with+eval để sandbox mutation reflect đúng |
| — | `net.ts` | 🔄 Pending | Socket.connect() TCP bridge — cần thay đổi tcp_worker.ts |
| — | Còn lại | ✅ OK | cluster, dns, dgram, zlib, readline, http2, tty, v8, perf_hooks, module, util, timers, stream, events đều đạt yêu cầu |

---

## Phase 1 — Completed Changes

### fs.ts — FD Position Tracking

**Vấn đề:** `fdMap` chỉ lưu `path`, mỗi `read()` luôn đọc từ offset truyền vào, không advance cursor.

**Giải pháp:**
```ts
interface FdEntry {
  path: string;
  position: number;
  flags: string | number;
}
const fdMap = new Map<number, FdEntry>();
```

- `open()` lưu `{ path, position: 0, flags }`. Append flags (`a`, `a+`) set position = EOF async.
- `read()` dùng `entry.position` khi `position === null`, advance sau khi read.
- `write()` dùng `entry.position` khi `position === null`, advance sau khi write.
- `fstat()` dùng `entry.path` thay vì `path` string.

**Thêm:**
- `lstatSync` → delegate `statSync` (VFS không có symlinks)
- `unlinkSync` → update syncCache + fire-and-forget async
- `rmdirSync` → purge syncCache prefix + fire-and-forget async
- `mkdirSync` → thêm marker vào syncCache để existsSync thấy ngay

### process.ts — hrtime + chdir

**hrtime fix:** Dùng `Date.now()` cho seconds component (Unix epoch), dùng `performance.now() % 1` cho sub-ms precision.

**chdir fix:** Check `PathUtils.isAbsolute(dir)` trước khi `join`.

### crypto.ts

**pbkdf2Sync:** Throw rõ ràng thay vì trả random bytes (silent wrong hash).

**scryptHash callback:** Fallback sang PBKDF2-SHA256 với 210_000 iterations.

**randomInt:** Rejection sampling với `crypto.getRandomValues()` — không bias, CSPRNG.

**createCipheriv / createDecipheriv:**
- Support: `AES-CBC`, `AES-CTR`, `AES-GCM`.
- `update()` buffer data, trả empty Buffer.
- `final()` → `Promise<Buffer>` — SubtleCrypto encrypt. Caller phải `await`.
- AES-GCM: `getAuthTag()` sau khi `await final()`, `setAuthTag()` cho decipher.
- Unsupported algo: throw với message rõ ràng.

**createSign / createVerify:**
- `update()` buffer data.
- `sign(key)` / `verify(key, sig)` → `Promise<Buffer | boolean>` — SubtleCrypto.
- Import PEM key: strip header/footer, base64 decode, `subtle.importKey('pkcs8'/'spki')`.
- Support: RSA PKCS1-v1_5, RSA-PSS, ECDSA P-256.

**generateKeyPair:**
- RSA/RSA-PSS: `subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5'/'RSA-PSS', ... })`
- EC: `subtle.generateKey({ name: 'ECDSA', namedCurve })`
- Export: `pkcs8` (private) + `spki` (public)

**generateKeyPairSync:** Throw rõ ràng.

**publicEncrypt / privateDecrypt / privateEncrypt / publicDecrypt:** Throw thay vì identity (security hole).

---

## Phase 2 — Completed Changes

### http.ts — Body Streaming

**IncomingMessage:**
```ts
// Internal state
private _bodyChunks: Buffer[] = [];
private _bodyEnded = false;
private _flowing = false;
private _encoding: BufferEncoding | null = null;

_pushChunk(chunk): void   // called by runner when request body arrives
_endBody(): void          // called when all body data received
```

- `resume()` → flush buffered chunks → emit `"data"` per chunk → emit `"end"`.
- `setEncoding(enc)` → encode chunks as strings.
- `pause()` → stop flowing.
- `pipe(dest)` → attach data/end → write/end on dest.

**ClientRequest._send():**
- Dùng `res.body.getReader()` ReadableStream API thay vì `arrayBuffer()`.
- Pump chunks qua `reader.read()` → `msg._pushChunk()`.
- Response lớn không buffer hết vào RAM.

**ServerResponse:**
- `end(body?)` tích lũy body cuối vào `_writeBuffer` trước khi emit `"finish"`.
- `_getBody()` → `Uint8Array` tổng hợp từ tất cả `write()` + `end()` calls.

**STATUS_CODES:** Đầy đủ 1xx–5xx (103, 206, 408, 409, 410, 413, 422, 451, 504, 507...).

**METHODS:** Đầy đủ tất cả HTTP methods theo Node.js 20.

### child_process.ts — stdin + kill + execFile

**ChildProcess.stdin:**
Queue/waiter pattern thay vì dead stub:
```ts
private _stdinQueue: Array<Uint8Array | null> = [];
private _stdinWaiter: ((v: Uint8Array | null) => void) | null = null;

stdin.write(chunk) → enqueue hoặc resolve pending waiter
stdin.end()        → enqueue null (EOF marker)
_readStdin()       → dequeue or wait for next chunk
```

**ChildProcess.kill():**
```ts
private _abortCtrl = new AbortController();
kill(signal?) → _abortCtrl.abort() → trả true
```

`spawnNode` truyền `__signal: proc._signal` vào `__runNode` để bootstrap có thể abort.

**exec tokenizer:**
Shell-like parser với quote handling:
- `exec('node "my file.js" --arg "hello world"')` hoạt động đúng.
- Support single/double quotes và backslash escape.

**execFile:**
- Fully implemented với argument normalization (handles `execFile(file)`, `execFile(file, args)`, `execFile(file, args, opts, cb)` overloads).
- Route node/npm/npx qua `spawnNode`.

**stdout/stderr pipe:**
```ts
this.stdout.pipe = (dest) => {
  this.stdout.on("data", chunk => dest.write(chunk));
  this.once("close", () => dest.end());
  return dest;
};
```

---

## Phase 3 — Completed Changes

### events.ts — Async Iterator

**events.on(emitter, event):**
Trả `AsyncIterable<unknown[]>`:
- Buffer events khi consumer chưa ready (backpressure).
- `return()` cleanup listeners.
- Error handling qua `"error"` event.

**getEventListeners(emitter, event):**
Gọi `emitter.listeners(event)` thay vì trả `[]` luôn.

**once():** Fix race condition — cleanup cross-listener (error xảy ra trước event).

### vm.ts — Sandbox Mutation

**runInNewContext:**
```ts
const wrapperSrc = `(function(__ctx__) {
  with (__ctx__) {
    try { return eval("(" + ${escapedCode} + ")"); }
    catch(_e1) { return eval(${escapedCode}); }
  }
})`;
```

- `with (__ctx__)` → sandbox properties visible as bare names.
- Assignments trong code write through to ctx object (non-strict mode).
- Expression form thử trước → return value. Statement form fallback.
- Dùng `JSON.stringify(code)` để safely embed code string.

---

## Còn lại — net.ts TCP Bridge

### Vấn đề
`net.Socket.connect()` là no-op — không bridge tới SAB TCP system. MySQL, Redis, PostgreSQL client packages tất cả fail silently.

### Thiết kế cần làm

Cần bootstrap inject `globalThis.__connectVirtualPort`:
```ts
// main.ts inject:
globalThis.__connectVirtualPort = async (port, host, callbacks) => {
  // Allocate SAB pair, register với tcp_worker.ts
  // callbacks: { onConnect, onData, onClose, onError }
  return { write(chunk), end(), destroy() }; // control handle
};
```

`net.Socket.connect()`:
```ts
connect(portOrOptions, hostOrCb?, cb?) {
  const connectHook = globalThis.__connectVirtualPort;
  this.connecting = true;
  connectHook(port, host, {
    onConnect: () => { this.readable = true; this.writable = true; this.emit('connect'); },
    onData: (chunk) => this.emit('data', chunk),
    onClose: () => { this.destroyed = true; this.emit('close'); },
    onError: (err) => this.emit('error', err),
  }).then(handle => this._handle = handle);
}
```

**Phụ thuộc:** `js/tcp_worker.ts` cần expose client-side connect API — đây là thay đổi phức tạp và cần implement riêng.

---

## Những thứ không thể implement trong browser

| Feature | Lý do |
|---------|-------|
| `crypto.pbkdf2Sync` thực | Web Crypto PBKDF2 là async-only |
| `crypto.createCipheriv` sync final() | SubtleCrypto async-only |
| `child_process.execSync` | Blocking event loop không thể |
| `vm` isolation thực sự | Không có separate realm API |
| `tls` | Browser không expose TLS socket primitives |
| `cluster` thực | Không có fork() trong browser |
| `dgram` UDP | Browser không có UDP API |
| `net` UNIX domain sockets | Không có filesystem sockets |
