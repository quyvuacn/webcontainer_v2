import { runNode } from '../node/cli'
import { createVirtualFSAdapter } from '../node/vfs/core/adapter'
import { registerWorkerVfsPort } from './main'

export type WorkerRefSlot = {
  current: { worker: Worker; resolve: (code: number) => void; children: Worker[] } | null
}

export function createNodeRunner(
  _rawVfs: unknown,
  terminal: { write: (s: string) => void; writeError?: (s: string) => void },
  workerRefSlot: WorkerRefSlot,
) {
  return async (args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): Promise<number> => {
    const { port1, port2 } = new MessageChannel()
    registerWorkerVfsPort(port1)

    const worker = new Worker(new URL('./worker_threads_runner.ts', import.meta.url), { type: 'module' })
    const ref = { worker, resolve: (_code: number) => {}, children: [] as Worker[] }
    workerRefSlot.current = ref

    return new Promise<number>((resolve) => {
      ref.resolve = resolve
      const cleanup = () => {
        workerRefSlot.current = null
        ref.children.forEach((c) => c.terminate())
        worker.terminate()
      }
      worker.onmessage = ({ data }: MessageEvent<{ type: string; data?: string | number; requestId?: number; args?: string[]; cwd?: string; env?: Record<string, string> }>) => {
        if (data.type === 'spawn') {
          const requestId = data.requestId ?? 0
          const { port1: p1, port2: p2 } = new MessageChannel()
          registerWorkerVfsPort(p1)
          const child = new Worker(new URL('./worker_threads_runner.ts', import.meta.url), { type: 'module' })
          ref.children.push(child)
          child.onmessage = ({ data: d }: MessageEvent<{ type: string; data?: string | number }>) => {
            if (d.type === 'stdout') worker.postMessage({ type: 'spawn_stdout', requestId, data: d.data })
            else if (d.type === 'stderr') worker.postMessage({ type: 'spawn_stderr', requestId, data: d.data })
            else if (d.type === 'exit') {
              worker.postMessage({ type: 'spawn_response', requestId, exitCode: (d.data as number) ?? 1 })
              child.terminate()
              const i = ref.children.indexOf(child)
              if (i >= 0) ref.children.splice(i, 1)
            }
          }
          child.onerror = () => {
            worker.postMessage({ type: 'spawn_response', requestId, exitCode: 1 })
            child.terminate()
            const i = ref.children.indexOf(child)
            if (i >= 0) ref.children.splice(i, 1)
          }
          child.postMessage({
            type: 'init',
            vfsPort: p2,
            args: data.args ?? [],
            cwd: data.cwd ?? opts.cwd ?? 'project',
            env: data.env ?? opts.env ?? {},
          }, [p2])
          return
        }
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

export function terminateWorkerInSlot(slot: WorkerRefSlot): boolean {
  const ref = slot.current
  if (ref) {
    ref.children.forEach((c) => c.terminate())
    ref.children.length = 0
    ref.resolve(130)
    ref.worker.terminate()
    slot.current = null
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
