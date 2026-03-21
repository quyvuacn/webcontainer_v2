import { deserializeRequest } from './http_serialize.js'
import { serializeResponse } from './http_serialize.js'

const DATA_OFF = 12

let handSab = null
let mainPort = null
let port = 0

self.onmessage = ({ data }) => {
  if (data.hand_sab) handSab = data.hand_sab
  if (data.mainPort) {
    mainPort = data.mainPort
    mainPort.onmessage = ({ data: msg }) => {
      if (msg.type === 'handler_response' && pendingResolve) {
        pendingResolve(msg.response)
        pendingResolve = null
      }
    }
  }
  if (data.port) port = data.port
  if (data.type === 'run' && handSab) runLoop()
}

let pendingResolve = null

async function runHandlerLoop() {
  const ctrl = new Int32Array(handSab)
  const data = new Uint8Array(handSab)

  while (true) {
    Atomics.wait(ctrl, 0, 0)
    if (Atomics.load(ctrl, 0) !== 1) continue

    const reqLen = Atomics.load(ctrl, 1)
    const req = deserializeRequest(data.slice(DATA_OFF, DATA_OFF + reqLen))

    let response
    if (mainPort) {
      mainPort.postMessage({ type: 'handle_request', port, request: req })
      response = await new Promise(r => { pendingResolve = r })
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
