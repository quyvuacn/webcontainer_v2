import { createBuffer, readBuffer } from './lib/sab_buffer.js'

const STDOUT_SIZE = 1024 * 1024

export function spawn(file, args = [], options = {}) {
  const { port1, port2 } = new MessageChannel()
  const { port1: ipc1, port2: ipc2 } = new MessageChannel()
  const stdout = createBuffer(STDOUT_SIZE)
  const stderr = createBuffer(65536)

  const worker = new Worker('/js/child_worker.js', { type: 'module' })
  worker.postMessage({ file, args, env: options.env || {}, stdout, stderr, vfsPort: port2, ipcPort: ipc2 }, [port2, ipc2])

  port1.onmessage = ({ data }) => {
    if (data.op === 'read') {
      const bytes = globalThis.__vfsRead?.(data.path)
      port1.postMessage({ id: data.id, bytes: bytes ? [...bytes] : null })
    } else if (data.op === 'write') {
      globalThis.__vfsWrite?.(data.path, new Uint8Array(data.bytes || []))
      port1.postMessage({ id: data.id })
    }
  }

  return {
    worker,
    stdout: () => readBuffer(stdout),
    stderr: () => readBuffer(stderr),
    on(ev, cb) {
      if (ev === 'exit') this._onExit = cb
      if (ev === 'message') ipc1.onmessage = ({ data }) => cb(data)
    },
    send(msg) { ipc1.postMessage(msg) },
    kill() { this.worker.terminate(); this._onExit?.(0) },
  }
}

export function spawnSync(file, args = [], options = {}) {
  const done = new SharedArrayBuffer(4)
  const stdout = createBuffer(STDOUT_SIZE)
  const stderr = createBuffer(65536)
  const { port1, port2 } = new MessageChannel()

  const worker = new Worker('/js/child_worker.js', { type: 'module' })
  worker.postMessage({ file, args, env: options.env || {}, done, stdout, stderr, vfsPort: port2 }, [port2])

  port1.onmessage = ({ data }) => {
    if (data.op === 'read') {
      const bytes = globalThis.__vfsRead?.(data.path)
      port1.postMessage({ id: data.id, bytes: bytes ? [...bytes] : null })
    } else if (data.op === 'write') {
      globalThis.__vfsWrite?.(data.path, new Uint8Array(data.bytes || []))
      port1.postMessage({ id: data.id })
    }
  }

  Atomics.wait(new Int32Array(done), 0, 0)
  worker.terminate()

  return {
    status: new Int32Array(done)[0],
    stdout: readBuffer(stdout),
    stderr: readBuffer(stderr),
  }
}
