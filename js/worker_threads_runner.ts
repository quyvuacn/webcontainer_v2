/**
 * Web Worker entrypoint for worker_threads.Worker(filename).
 *
 * Protocol (init from main):
 *   { type: 'init', vfsPort, filename, workerData, cwd, env, threadId }
 *
 * Protocol (messages to main):
 *   { type: 'message', data }
 *   { type: 'error', data }
 *   { type: 'exit', data }
 *   { type: 'stdout', data } / { type: 'stderr', data }
 */

import type { Stats } from '../node/vfs/core/adapter'
import { runNode } from '../node/cli'
import { PathUtils } from '../node/vfs/core/path'

let parentPortListeners: ((data: unknown) => void)[] = []

const parentPort = {
  postMessage(data: unknown, _transfer?: Transferable[]) {
    self.postMessage({ type: 'message', data })
  },
  on(_event: string, fn: (data: unknown) => void) {
    if (_event === 'message') parentPortListeners.push(fn)
  },
  once(_event: string, fn: (data: unknown) => void) {
    if (_event === 'message') {
      const wrapper = (data: unknown) => {
        fn(data)
        parentPortListeners = parentPortListeners.filter((l) => l !== wrapper)
      }
      parentPortListeners.push(wrapper)
    }
  },
  off(_event: string, fn: (data: unknown) => void) {
    if (_event === 'message') parentPortListeners = parentPortListeners.filter((l) => l !== fn)
  },
  removeListener(e: string, fn: (data: unknown) => void) {
    this.off(e, fn)
  },
  addListener(e: string, fn: (data: unknown) => void) {
    this.on(e, fn)
  },
}

function createPortVfs(port: MessagePort) {
  let id = 0
  const pending = new Map<string, { resolve: (v: unknown) => void }>()
  type PortRes = { id?: string; bytes?: number[] | null; ok?: boolean; names?: string[]; stat?: { isFile: boolean; isDirectory: boolean; size: number; mtime: number } | null }
  port.onmessage = ({ data }: MessageEvent<PortRes>) => {
    if (data.id && pending.has(data.id)) {
      const p = pending.get(data.id)!
      pending.delete(data.id)
      p.resolve(data)
    }
  }
  const send = (op: string, extra: Record<string, unknown> = {}) =>
    new Promise<PortRes>((resolve) => {
      const rid = `${++id}`
      pending.set(rid, { resolve: resolve as (v: unknown) => void })
      port.postMessage({ op, id: rid, ...extra })
    })
  const norm = (p: string) => (p.startsWith('/') ? p.slice(1) : p)

  return {
    async readFile(path: string, encoding?: string): Promise<string | Uint8Array> {
      const res = await send('read', { path: norm(path) })
      if (!res.bytes) throw Object.assign(new Error(`ENOENT: '${path}'`), { code: 'ENOENT' })
      const arr = new Uint8Array(res.bytes)
      return encoding === 'utf8' || encoding === 'utf-8' ? new TextDecoder().decode(arr) : arr
    },
    async writeFile(path: string, content: string | Uint8Array): Promise<void> {
      const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content)
      await send('write', { path: norm(path), bytes: [...bytes] })
    },
    async mkdir(path: string, _opts?: { recursive?: boolean }): Promise<void> {
      await send('mkdir', { path: norm(path) })
    },
    async exists(path: string): Promise<boolean> {
      const res = await send('exists', { path: norm(path) })
      return res.ok ?? false
    },
    async stat(path: string): Promise<Stats> {
      const res = await send('stat', { path: norm(path) })
      const s = res.stat
      if (!s) throw Object.assign(new Error(`ENOENT: '${path}'`), { code: 'ENOENT' })
      const t = new Date(s.mtime ?? 0)
      return {
        ino: 0,
        size: s.size ?? 0,
        mode: 0o644,
        atime: t,
        mtime: t,
        ctime: t,
        isFile: () => s.isFile,
        isDirectory: () => s.isDirectory,
        isSymbolicLink: () => false,
      }
    },
    async readdir(path: string): Promise<string[]> {
      const res = await send('readdir', { path: norm(path) })
      return res.names ?? []
    },
  }
}

self.onmessage = async ({ data }: MessageEvent<{ type: string; vfsPort?: MessagePort; filename?: string; workerData?: unknown; cwd?: string; env?: Record<string, string>; threadId?: number }>) => {
  if (data.type === 'init') {
    const { vfsPort, filename, workerData, cwd = '/', env = {}, threadId = 0 } = data
    if (!vfsPort || !filename) {
      self.postMessage({ type: 'error', data: 'worker_threads_runner: init requires vfsPort and filename' })
      self.postMessage({ type: 'exit', data: 1 })
      return
    }

    ;(globalThis as Record<string, unknown>).workerData = workerData
    ;(globalThis as Record<string, unknown>).parentPort = parentPort
    ;(globalThis as Record<string, unknown>).isMainThread = false
    ;(globalThis as Record<string, unknown>).threadId = threadId

    const vfs = createPortVfs(vfsPort)
    const terminal = {
      write: (t: string) => self.postMessage({ type: 'stdout', data: t }),
      writeError: (t: string) => self.postMessage({ type: 'stderr', data: t }),
    }

    try {
      const resolvedPath = PathUtils.isAbsolute(filename) ? PathUtils.normalize(filename) : PathUtils.join(cwd, filename)
      const exitCode = await runNode([resolvedPath], vfs, terminal, { cwd, env })
      self.postMessage({ type: 'exit', data: exitCode })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      self.postMessage({ type: 'error', data: msg })
      self.postMessage({ type: 'exit', data: 1 })
    }
    return
  }

  if (data.type === 'message') {
    const payload = data as { type: string; data?: unknown }
    for (const fn of parentPortListeners) {
      try {
        fn(payload.data)
      } catch {}
    }
  }
}
