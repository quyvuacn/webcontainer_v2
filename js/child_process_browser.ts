import { createBuffer, readBuffer } from './lib/sab_buffer'

const STDOUT_SIZE = 1024 * 1024

export function spawn(file: string, args: string[] = [], options: { env?: Record<string, string> } = {}) {
  const { port1, port2 } = new MessageChannel()
  const { port1: ipc1, port2: ipc2 } = new MessageChannel()
  const stdout = createBuffer(STDOUT_SIZE)
  const stderr = createBuffer(65536)

  const worker = new Worker(new URL('./child_worker.ts', import.meta.url), { type: 'module' })
  worker.postMessage({ file, args, env: options.env || {}, stdout, stderr, vfsPort: port2, ipcPort: ipc2 }, [port2, ipc2])

  port1.onmessage = ({ data }: MessageEvent<{ op: string; id?: string; path?: string; bytes?: number[] }>) => {
    if (data.op === 'read') {
      const bytes = (globalThis as { __vfsRead?: (path: string) => Uint8Array | null }).__vfsRead?.(data.path!)
      port1.postMessage({ id: data.id, bytes: bytes ? [...bytes] : null })
    } else if (data.op === 'write') {
      ;(globalThis as { __vfsWrite?: (path: string, bytes: Uint8Array) => void }).__vfsWrite?.(data.path!, new Uint8Array(data.bytes || []))
      port1.postMessage({ id: data.id })
    }
  }

  return {
    worker,
    stdout: () => readBuffer(stdout),
    stderr: () => readBuffer(stderr),
    on(ev: string, cb: (data: unknown) => void) {
      if (ev === 'exit') (this as { _onExit?: (code: number) => void })._onExit = cb
      if (ev === 'message') ipc1.onmessage = ({ data }) => cb(data)
    },
    send(msg: unknown) { ipc1.postMessage(msg) },
    kill() { this.worker.terminate(); (this as { _onExit?: (code: number) => void })._onExit?.(0) },
  }
}

export function spawnSync(file: string, args: string[] = [], options: object = {}) {
  throw new Error('spawnSync is deprecated. Use spawnSyncAsync (returns Promise).')
}

const SPAWN_TIMEOUT_MS = 15000

export function spawnSyncAsync(file: string, args: string[] = [], options: { env?: Record<string, string> } = {}) {
  const done = new SharedArrayBuffer(4)
  const stdout = createBuffer(STDOUT_SIZE)
  const stderr = createBuffer(65536)
  const { port1, port2 } = new MessageChannel()

  const worker = new Worker(new URL('./child_worker.ts', import.meta.url), { type: 'module' })
  worker.postMessage({ file, args, env: options.env || {}, done, stdout, stderr, vfsPort: port2 }, [port2])

  port1.onmessage = ({ data }: MessageEvent<{ op: string; id?: string; path?: string; bytes?: number[] }>) => {
    if (data.op === 'read') {
      const bytes = (globalThis as { __vfsRead?: (path: string) => Uint8Array | null }).__vfsRead?.(data.path!)
      port1.postMessage({ id: data.id, bytes: bytes ? [...bytes] : null })
    } else if (data.op === 'write') {
      ;(globalThis as { __vfsWrite?: (path: string, bytes: Uint8Array) => void }).__vfsWrite?.(data.path!, new Uint8Array(data.bytes || []))
      port1.postMessage({ id: data.id })
    }
  }

  return new Promise<{ status: number; stdout: string; stderr: string }>((resolve, reject) => {
    const finish = (result: { status: number; stdout: string; stderr: string }) => {
      clearTimeout(timer)
      worker.terminate()
      resolve(result)
    }
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error(`node: timeout after ${SPAWN_TIMEOUT_MS / 1000}s (Worker may have failed to load)`))
    }, SPAWN_TIMEOUT_MS)
    worker.onerror = (e: ErrorEvent) => {
      clearTimeout(timer)
      worker.terminate()
      reject(new Error('node: Worker failed to load: ' + (e.message || e)))
    }
    worker.onmessage = ({ data }: MessageEvent<{ type?: string }>) => {
      if (data?.type === 'done') {
        finish({
          status: new Int32Array(done)[0],
          stdout: readBuffer(stdout),
          stderr: readBuffer(stderr),
        })
      }
    }
  })
}
