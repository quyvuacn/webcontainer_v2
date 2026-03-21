import { runNode } from '../node/cli'
import { createVirtualFSAdapter } from '../node/vfs/core/adapter'
import { registerWorkerVfsPort } from './main'

export function createNodeRunner(_rawVfs: unknown, terminal: { write: (s: string) => void; writeError?: (s: string) => void }) {
  return async (args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): Promise<number> => {
    const { port1, port2 } = new MessageChannel()
    registerWorkerVfsPort(port1)

    const worker = new Worker(new URL('./worker_threads_runner.ts', import.meta.url), { type: 'module' })
    const ref = { worker, resolve: (_code: number) => {} }
    ;(globalThis as { __wcNodeWorkerRef?: { worker: Worker; resolve: (code: number) => void } }).__wcNodeWorkerRef = ref

    return new Promise<number>((resolve) => {
      ref.resolve = resolve
      const cleanup = () => {
        delete (globalThis as { __wcNodeWorkerRef?: typeof ref }).__wcNodeWorkerRef
        worker.terminate()
      }
      worker.onmessage = ({ data }: MessageEvent<{ type: string; data?: string | number }>) => {
        if (data.type === 'stdout') terminal.write(String(data.data ?? ''))
        else if (data.type === 'stderr') (terminal.writeError ?? terminal.write)(String(data.data ?? ''))
        else if (data.type === 'exit') {
          cleanup()
          resolve((data.data as number) ?? 1)
        }
      }
      worker.onerror = (e) => {
        (terminal.writeError ?? terminal.write)(`Worker error: ${e.message}\n`)
        cleanup()
        resolve(1)
      }
      worker.postMessage({
        type: 'init',
        vfsPort: port2,
        args,
        cwd: opts.cwd ?? 'project',
        env: opts.env ?? {},
      }, [port2])
    })
  }
}

export function terminateCurrentNodeWorker(): boolean {
  const ref = (globalThis as { __wcNodeWorkerRef?: { worker: Worker; resolve: (code: number) => void } }).__wcNodeWorkerRef
  if (ref) {
    ref.resolve(130)
    ref.worker.terminate()
    delete (globalThis as { __wcNodeWorkerRef?: typeof ref }).__wcNodeWorkerRef
    return true
  }
  return false
}

export function createSpawnSyncAsync(rawVfs: unknown) {
  const vfs = createVirtualFSAdapter(rawVfs as Parameters<typeof createVirtualFSAdapter>[0])
  return async (filePath: string, args: string[] = [], opts: { cwd?: string; env?: Record<string, string> } = {}) => {
    const out: string[] = [], err: string[] = []
    const terminal = {
      write: (t: string) => out.push(t),
      writeError: (t: string) => err.push(t),
    }
    const cwd = opts.cwd || 'project'
    const entry = filePath.startsWith('/') ? filePath : '/' + filePath
    const status = await runNode([entry, ...args], vfs, terminal, { cwd, env: opts.env })
    return { stdout: out.join(''), stderr: err.join(''), status }
  }
}
