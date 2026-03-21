import { serializeResponse } from './http_serialize'

const SAB_SIZE = 4 * 1024 * 1024
const DATA_OFF = 12
const TIMEOUT_MS = 30000

let swSab: SharedArrayBuffer | null = null
let handSab: SharedArrayBuffer | null = null

;(self as Worker).onmessage = ({ data }: MessageEvent<{ sw_sab?: SharedArrayBuffer; hand_sab?: SharedArrayBuffer }>) => {
  swSab = data.sw_sab!
  handSab = data.hand_sab!
  runLoop()
}

function runLoop() {
  const swCtrl = new Int32Array(swSab!)
  const handCtrl = new Int32Array(handSab!)
  const swData = new Uint8Array(swSab!)
  const handData = new Uint8Array(handSab!)

  function waitWithTimeout(ctrl: Int32Array, idx: number, expected: number, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs
    while (Atomics.load(ctrl, idx) === expected) {
      if (Date.now() > deadline) return false
      Atomics.wait(ctrl, idx, expected, 50)
    }
    return true
  }

  while (true) {
    Atomics.wait(swCtrl, 0, 0)
    const status = Atomics.load(swCtrl, 0)
    if (status !== 1) continue

    const reqLen = Atomics.load(swCtrl, 1)
    if (reqLen <= 0 || reqLen > SAB_SIZE - DATA_OFF) {
      const err = serializeResponse(400, {}, 'Bad request')
      swData.set(err, DATA_OFF + reqLen)
      Atomics.store(swCtrl, 2, err.length)
      Atomics.store(swCtrl, 0, 2)
      Atomics.notify(swCtrl, 0)
      continue
    }

    handData.set(swData.slice(DATA_OFF, DATA_OFF + reqLen), DATA_OFF)
    Atomics.store(handCtrl, 1, reqLen)
    Atomics.store(handCtrl, 0, 1)
    Atomics.notify(handCtrl, 0)

    if (!waitWithTimeout(handCtrl, 0, 1, TIMEOUT_MS)) {
      const err = serializeResponse(503, {}, 'Gateway Timeout')
      swData.set(err, DATA_OFF)
      Atomics.store(swCtrl, 2, err.length)
      Atomics.store(swCtrl, 0, 2)
      Atomics.notify(swCtrl, 0)
      continue
    }

    const respLen = Atomics.load(handCtrl, 2)
    swData.set(handData.slice(DATA_OFF + reqLen, DATA_OFF + reqLen + respLen), DATA_OFF + reqLen)
    Atomics.store(swCtrl, 2, respLen)
    Atomics.store(swCtrl, 0, 2)
    Atomics.notify(swCtrl, 0)
  }
}
