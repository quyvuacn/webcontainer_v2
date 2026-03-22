import { deserializeRequest, serializeResponse } from './http_serialize'

const DATA_OFF = 12

let handSab: SharedArrayBuffer | null = null
let mainPort: MessagePort | null = null
let port: MessagePort | number = 0

let pendingResolve: ((response: { status?: number; headers?: Record<string, string>; body?: string }) => void) | null = null

;(self as unknown as Worker).onmessage = ({ data }: MessageEvent<{ hand_sab?: SharedArrayBuffer; mainPort?: MessagePort; port?: MessagePort; type?: string }>) => {
  if (data.hand_sab) handSab = data.hand_sab
  if (data.mainPort) {
    mainPort = data.mainPort
    mainPort.onmessage = ({ data: msg }: MessageEvent<{ type: string; response?: { status?: number; headers?: Record<string, string>; body?: string } }>) => {
      if (msg.type === 'handler_response' && pendingResolve) {
        pendingResolve(msg.response!)
        pendingResolve = null
      }
    }
  }
  if (data.port) port = data.port
  if (data.type === 'run' && handSab) runLoop()
}

async function runHandlerLoop() {
  const ctrl = new Int32Array(handSab!)
  const data = new Uint8Array(handSab!)

  while (true) {
    Atomics.wait(ctrl, 0, 0)
    if (Atomics.load(ctrl, 0) !== 1) continue

    const reqLen = Atomics.load(ctrl, 1)
    const req = deserializeRequest(data.slice(DATA_OFF, DATA_OFF + reqLen))

    let response: { status?: number; headers?: Record<string, string>; body?: string }
    if (mainPort) {
      mainPort.postMessage({ type: 'handle_request', port, request: req })
      response = await new Promise<{ status?: number; headers?: Record<string, string>; body?: string }>(r => { pendingResolve = r })
    } else {
      response = { status: 200, headers: { 'Content-Type': 'text/plain' }, body: 'Hello from Virtual TCP' }
    }

    const respBytes = serializeResponse(response.status || 200, response.headers || {}, response.body || '')
    data.set(respBytes, DATA_OFF + reqLen)
    Atomics.store(ctrl, 2, respBytes.length)
    Atomics.store(ctrl, 0, 2)
    Atomics.notify(ctrl, 0)
  }
}

function runLoop() {
  runHandlerLoop()
}
