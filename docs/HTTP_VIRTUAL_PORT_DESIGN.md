# Thiết kế xử lý HTTP qua Virtual Port

Tài liệu mô tả kiến trúc và luồng xử lý HTTP request khi truy cập `http://localhost:PORT/...` với server Node chạy trong browser (WebContainer).

## Tổng quan

URL pattern `/__port__/<PORT>/<path>` được Service Worker (SW) intercept. SW chuyển request sang Main thread qua MessagePort. Main ghi vào SharedArrayBuffer (SAB), pipeline Worker xử lý và chuyển tới Node server. Response đi ngược lại.

## Sơ đồ luồng

```
[Client] fetch('/__port__/5173/')
    │
    ▼
[SW] portMatch → portMainChannels.get(5173) ?
    │   ├─ không có → unavailableResponse() (503)
    │   └─ có mainPort → handleVirtualTcpViaMain()
    │         │
    │         ├─ serializeRequest() → reqBytes
    │         ├─ MessageChannel(respIn, respOut)
    │         ├─ mainPort.postMessage({ requestBytes, responsePort: respOut }, [respOut])
    │         └─ chờ respIn.onmessage (timeout 30s)
    │
    ▼
[Main] mainPort.onmessage
    │   ├─ processVirtualTcpRequest(port, reqBytes)
    │   │     ├─ ghi request vào swSab, Atomics.notify(swCtrl, 0)
    │   │     ├─ Atomics.waitAsync(swCtrl, 0, 1) — chờ response (timeout 15s)
    │   │     └─ đọc respBytes từ swSab
    │   └─ responsePort.postMessage({ responseBytes })
    │
    ▼
[tcp_worker] Atomics.wait(swCtrl, 0, 0) wake
    │   ├─ copy swData → handData
    │   ├─ Atomics.notify(handCtrl, 0)
    │   └─ Atomics.wait(handCtrl, 0, 1) — chờ handler_worker (timeout 30s)
    │
    ▼
[handler_worker] Atomics.wait(handCtrl, 0, 0) wake
    │   ├─ deserializeRequest()
    │   ├─ mainPort.postMessage({ type: 'handle_request', port, request })
    │   └─ pendingResolve = Promise — chờ handler_response
    │
    ▼
[Main] port1.onmessage (setupVirtualPort)
    │   ├─ cb = portHandlers.get(port) — handler từ run_node
    │   └─ cb(req, res) — gọi handler
    │
    ▼
[run_node] handler
    │   ├─ reqPort.postMessage({ type: 'virtual_tcp_request', requestId, method, url, headers, body })
    │   └─ chờ virtual_tcp_response qua pending
    │
    ▼
[worker_threads_runner] port1.onmessage
    │   ├─ IncomingMessage, ServerResponse
    │   ├─ handler(req, res) — Node http server handler
    │   └─ res.end() → port1.postMessage({ type: 'virtual_tcp_response', requestId, status, headers, body })
    │
    ▼
[Response] đi ngược lại qua handler_worker → tcp_worker → Main → SW → Client
```

## Thành phần chính

| File                          | Vai trò                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `public/sw.js`                | Intercept fetch `/__port__/N/`, portMainChannels, handleVirtualTcpViaMain, serialize/deserialize |
| `js/main.ts`                  | sendPortToSw, processVirtualTcpRequest, setupVirtualPort, port1.onmessage gọi handler            |
| `js/run_node.ts`              | Nhận register_virtual_port, setupVirtualPort với handler đẩy virtual_tcp_request                 |
| `js/tcp_worker.ts`            | Bridge swSab ↔ handSab qua Atomics                                                               |
| `js/handler_worker.ts`        | Deserialize request, post handle_request, chờ handler_response                                   |
| `js/worker_threads_runner.ts` | setupTcpRegHook, \_\_setupVirtualPort, nhận virtual_tcp_request, gọi Node handler                |
| `js/http_serialize.ts`        | serializeRequest, deserializeRequest, serializeResponse, deserializeResponse                     |

## Đăng ký port

1. `node server.js` → worker_threads_runner chạy, gọi `http.createServer().listen(5173)`
2. Polyfill listen() gọi `__setupVirtualPort(5173, handler)`
3. setupTcpRegHook gửi `register_virtual_port` với requestPort qua tcpRegPort
4. run_node nhận → gọi `setupVirtualPort(5173, handler)`
5. setupVirtualPort: tạo swSab, handSab, tcp_worker, handler_worker, gọi `sendPortToSw(5173, swSab)`
6. sendPortToSw: tạo MessageChannel, gắn mainPort.onmessage, gửi `register_port` với swPort tới SW
7. SW nhận → `portMainChannels.set(5173, mainPort)`

## Lưu ý và bug đã điều tra

### 1. SharedArrayBuffer không gửi qua postMessage sang SW

**Vấn đề:** SW chạy ở agent cluster khác, không thể nhận SharedArrayBuffer qua `postMessage` từ page.

**Giải pháp:** Dùng MessagePort thay vì SAB để SW ↔ Main giao tiếp. Main gửi `swPort` (một đầu MessageChannel) cho SW. SW giữ để post request, Main giữ `mainPort` để nhận và xử lý.

### 2. navigator.serviceWorker.controller = null

**Vấn đề:** Khi page load lần đầu hoặc SW vừa activate, `navigator.serviceWorker.controller` có thể null. Gọi `ctrl?.postMessage(...)` không gửi được message.

**Triệu chứng:** Log `hasController: false`, SW không nhận register_port, portMainChannels rỗng, fetch trả 503 hoặc timeout.

**Giải pháp:** Fallback dùng `navigator.serviceWorker.getRegistration().then(reg => reg?.active)` để post message trực tiếp tới SW, không phụ thuộc controller.

```javascript
const ctrl = navigator.serviceWorker.controller;
ctrl
  ? post(ctrl)
  : navigator.serviceWorker
      .getRegistration()
      .then((r) => post(r?.active ?? null));
```

### 3. Stale mainPort / dead port

**Vấn đề:** Khi user chạy node, dừng (Ctrl+C), rồi reload page — SW vẫn giữ mainPort cũ trong portMainChannels. MessagePort đó đã "chết" vì đầu kia ở page cũ đã bị GC. Post qua port chết → Main không nhận → timeout 30s.

**Triệu chứng:** Fetch treo 30s, sau đó "network error" hoặc "Uncaught Error: timeout".

**Giải pháp:** Trong handleVirtualTcpViaMain, `p.catch(() => unavailableResponse())` — bắt mọi lỗi (timeout, messageerror) và trả Response 503 thay vì reject promise. Client nhận 503 thay vì network error.

### 4. Timeout cần reject và close

**Lưu ý:** Chỉ `respIn.close()` không đủ. Promise `p` phải được settle (resolve hoặc reject). Nếu không gọi `reject()`, fetch sẽ treo mãi. `close()` chỉ đóng port, không kích hoạt onmessage.

**Lưu ý:** fetch() không có built-in timeout. Phải tự implement (setTimeout + reject) hoặc dùng AbortController.

### 5. Trang lỗi giống trình duyệt

**Thiết kế:** Khi server không khả dụng, trả Response 503 với nội dung giống Chrome: "This site can't be reached / localhost refused to connect" thay vì custom "Port chưa sẵn sàng".

### 6. curl in lỗi trễ khi Ctrl+C

**Vấn đề:** User chạy `curl 1` (server chưa chạy), nhấn Ctrl+C. Fetch vẫn chạy (chờ timeout 30s). Khi fetch fail, catch block gọi `writeln(...)` — nội dung lỗi in ra sau khi user đã thấy prompt mới.

**Giải pháp:**

- Shell: AbortController mỗi lệnh, `abortCurrentCommand()` khi Ctrl+C
- App: Gọi `shell.abortCurrentCommand()` trong handler Ctrl+C
- Curl: Truyền `signal: abortSignal` vào fetch, kiểm tra `abortSignal?.aborted` trước mỗi writeln, return exitCode 130 khi đã abort

### 7. controllerchange để re-register

Khi SW update và controller thay đổi, các port cũ mất. Shell lắng nghe `controllerchange`, gọi `reRegisterPorts()` để gửi lại register_port cho mọi port trong portSabs.

### 8. COEP/COOP headers

Response từ handleVirtualTcpViaMain và unavailableResponse phải có:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

Cần cho SharedArrayBuffer và cross-origin isolation khi load trong iframe.

## Timeout trong pipeline

| Vị trí                        | Timeout | Khi nào                                             |
| ----------------------------- | ------- | --------------------------------------------------- |
| SW handleVirtualTcpViaMain    | 30s     | Main không response qua MessagePort                 |
| Main processVirtualTcpRequest | 15s     | tcp_worker/handler_worker/Node không trả về qua SAB |
| tcp_worker waitWithTimeout    | 30s     | handler_worker không xử lý xong                     |

## Format serialize

**Request (SW → Main):** `Uint8Array`: [4B metaLen LE][meta JSON][body bytes]

**Response (handler → SW):** Tương tự — meta có `status`, `headers`; body là payload.
