import { RamVfs } from './vfs_ram'
import { initWasmVfs } from './vfs_wasm'
import { initOpfsBridge, opfsWrite, opfsDelete, opfsListAll, createBroadcastChannel } from './opfs_bridge'
import { VFS_PREFIX } from './config'
import { createCdnVfsProxy } from './cdn/vfs_proxy'
const SAB_SIZE = 4 * 1024 * 1024

let vfs: { read: (p: string) => Uint8Array | null; write: (p: string, c: Uint8Array | string) => void; acquireLock?: (p: string) => number; releaseLock?: (id: number) => void; delete?: (p: string) => boolean; invalidate?: (p: string) => void; preload?: (p: string, c: Uint8Array) => void } | null = null
const portHandlers = new Map<number, (req: unknown, res: unknown) => void>()

function acquireTabLock(): Promise<void> {
  return new Promise((resolve, reject) => {
    navigator.locks.request('browser_node_project', { mode: 'exclusive', ifAvailable: true }, lock => {
      if (!lock) {
        reject(new Error('Project already open in another tab'))
        return
      }
      resolve()
      return new Promise(() => {})
    })
  })
}

type VfsPortMsg = {
  op: string
  id?: string
  path?: string
  bytes?: number[]
  prefix?: string
  lockId?: number
}

function handleVfsPort(port: MessagePort) {
  const v = vfs as {
    read: (p: string) => Uint8Array | null
    write: (p: string, c: Uint8Array) => void
    acquireLock?: (p: string) => number
    releaseLock?: (id: number) => void
    delete?: (p: string) => boolean
    exists?: (p: string) => boolean
    readdir?: (p: string) => string[] | Promise<string[]>
    stat?: (p: string) => { isFile: () => boolean; isDirectory: () => boolean; size?: number; mtime?: Date } | null
    mkdir?: (p: string) => void
  } | null
  port.onmessage = async ({ data }: MessageEvent<VfsPortMsg>) => {
    const path = (data.path ?? '').replace(/^\/+/, '')
    switch (data.op) {
      case 'read': {
        const bytes = v!.read(path)
        port.postMessage({ id: data.id, bytes: bytes ? [...bytes] : null })
        break
      }
      case 'write': {
        v!.write(path, new Uint8Array(data.bytes || []))
        port.postMessage({ id: data.id })
        break
      }
      case 'acquire_lock': {
        const lockId = v!.acquireLock?.(data.prefix ?? '') ?? 0
        port.postMessage({ id: data.id, lockId })
        break
      }
      case 'release_lock': {
        v!.releaseLock?.(data.lockId!)
        port.postMessage({ id: data.id })
        break
      }
      case 'delete': {
        const ok = v!.delete?.(path) ?? false
        port.postMessage({ id: data.id, ok })
        break
      }
      case 'exists': {
        const ok = v!.exists?.(path) ?? (v!.read(path) !== null)
        port.postMessage({ id: data.id, ok })
        break
      }
      case 'readdir': {
        const names = v!.readdir ? await Promise.resolve(v!.readdir(path)) : []
        port.postMessage({ id: data.id, names })
        break
      }
      case 'stat': {
        const st = v!.stat?.(path)
        port.postMessage({
          id: data.id,
          stat: st ? { isFile: st.isFile(), isDirectory: st.isDirectory(), size: st.size ?? 0, mtime: (st.mtime as Date)?.getTime?.() ?? 0 } : null,
        })
        break
      }
      case 'mkdir': {
        v!.mkdir?.(path)
        port.postMessage({ id: data.id })
        break
      }
    }
  }
}

export function registerWorkerVfsPort(port: MessagePort) {
  if (vfs) handleVfsPort(port)
}

export function getVfsRead(path: string) {
  const p = path.startsWith('/') ? path.slice(1) : path
  return vfs ? vfs.read(p) : null
}

export function setupVirtualPort(port: number, handler: (req: unknown, res: unknown) => void) {
  portHandlers.set(port, handler)
  const swSab = new SharedArrayBuffer(SAB_SIZE)
  const handSab = new SharedArrayBuffer(SAB_SIZE)
  const { port1, port2 } = new MessageChannel()

  port1.onmessage = ({ data }: MessageEvent<{ type: string; port?: number; request?: unknown }>) => {
    if (data.type === 'handle_request') {
      const cb = portHandlers.get(data.port ?? 0)
      const res = {
        statusCode: 200,
        _headers: {} as Record<string, string>,
        _done: false,
        setHeader(k: string, v: string) { this._headers[k] = v },
        end(body = '') {
          if (this._done) return
          this._done = true
          port1.postMessage({
            type: 'handler_response',
            response: { status: this.statusCode || 200, headers: this._headers, body }
          })
        }
      }
      try {
        if (cb) cb(data.request!, res)
        else res.end('No handler')
      } catch (e) {
        res.statusCode = 500
        res.end(String(e))
      }
    }
  }

  const tcpWorker = new Worker('/js/tcp_worker.ts', { type: 'module' })
  tcpWorker.postMessage({ sw_sab: swSab, hand_sab: handSab })

  const handlerWorker = new Worker('/js/handler_worker.ts', { type: 'module' })
  handlerWorker.postMessage({ hand_sab: handSab, mainPort: port2, port: port }, [port2])

  handlerWorker.postMessage({ type: 'run' })

  navigator.serviceWorker.controller?.postMessage({ type: 'register_port', port, buffer: swSab })
}

export function createServer(handler: (req: unknown, res: unknown) => void) {
  return {
    listen(port: number) {
      setupVirtualPort(port, (req, res) => {
        const url = new URL((req as { url: string }).url)
        ;(req as { path: string }).path = url.pathname.replace(/^\/__port__\/\d+/, '') || '/'
        handler(req, res)
      })
    }
  }
}

async function bootstrap() {
  const reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
  await reg.update()
  if (reg.waiting) {
    reg.waiting.postMessage({ type: 'SKIP_WAITING' })
    reg.addEventListener('controllerchange', () => location.reload(), { once: true })
  }
  if (!crossOriginIsolated) {
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
    location.reload()
    return
  }

  await acquireTabLock()

  initOpfsBridge('/js/opfs_worker.ts')

  try {
    const wasm = await initWasmVfs()
    let ok = false
    try {
      wasm?.preload?.('vfscheck', new Uint8Array([1]))
    } catch (e) {
      console.warn('[bootstrap] WASM preload failed:', (e as Error)?.message ?? e)
      throw e
    }
    try {
      ok = wasm?.read?.('vfscheck')?.length === 1
    } catch (e) {
      console.warn('[bootstrap] WASM read failed:', (e as Error)?.message ?? e)
      throw e
    }
    try {
      if (wasm?.delete) wasm.delete('vfscheck')
    } catch (e) {
      console.warn('[bootstrap] WASM delete failed:', (e as Error)?.message ?? e)
      throw e
    }
    vfs = ok ? wasm : new RamVfs(opfsWrite, opfsDelete)
    if (!ok) console.warn('[bootstrap] WASM VFS failed self-check, using JS RamVfs')
  } catch (e) {
    console.warn('[bootstrap] WASM VFS fallback to JS:', (e as Error)?.message ?? e)
    vfs = new RamVfs(opfsWrite, opfsDelete)
  }
  let results: { path: string; content: Uint8Array }[] = []
  try {
    results = await Promise.race([
      opfsListAll(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('OPFS timeout')), 3000))
    ])
  } catch (e) {
    console.warn('[bootstrap] opfsListAll:', (e as Error)?.message ?? e)
  }
  for (const { path, content } of results) {
    vfs!.preload?.(path, content)
  }

  const skipInvalidate = new Map<string, number>()
  if (vfs && typeof vfs.write === 'function') {
    const orig = vfs.write.bind(vfs)
    vfs.write = (p: string, c: Uint8Array | string) => {
      skipInvalidate.set(p, (skipInvalidate.get(p) || 0) + 1)
      orig(p, c)
    }
  }
  createBroadcastChannel((path: string) => {
    const n = skipInvalidate.get(path) || 0
    if (n > 0) {
      skipInvalidate.set(path, n - 1)
      if (n === 1) skipInvalidate.delete(path)
      return
    }
    vfs?.invalidate?.(path)
  })

  const sw = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<ServiceWorker | null>((_, reject) => setTimeout(() => reject(new Error('Service Worker timeout')), 5000))
  ]).catch(e => {
    console.warn('[bootstrap] SW ready:', (e as Error)?.message ?? e)
    return null
  })
  if (sw?.active) sw.active.postMessage({ type: 'VFS_READY' })

  const cdnProxy = createCdnVfsProxy(getVfsRead, (p, b) => vfs?.write(p, b))
  navigator.serviceWorker.addEventListener('message', async ({ data }: MessageEvent<{ type: string; path?: string; requestId?: string }>) => {
    if (data.type === 'vfs_request') {
      let bytes = getVfsRead(data.path!)
      if (!bytes) bytes = await cdnProxy.read(data.path!)
      navigator.serviceWorker.controller?.postMessage({ type: 'vfs_response', requestId: data.requestId, bytes: bytes ? [...bytes] : null })
    }
  })

  ;(globalThis as { __vfsRead?: (path: string) => Uint8Array | null }).__vfsRead = getVfsRead
  ;(globalThis as { __vfsWrite?: (path: string, bytes: Uint8Array) => void }).__vfsWrite = (path, bytes) => vfs?.write(path, bytes)

  return { vfs, VFS_PREFIX, createServer, setupVirtualPort, registerWorkerVfsPort }
}

export { bootstrap, RamVfs }
