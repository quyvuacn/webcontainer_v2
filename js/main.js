import { RamVfs } from './vfs_ram.js'
import { initOpfsBridge, opfsWrite, opfsDelete, opfsListAll, createBroadcastChannel } from './opfs_bridge.js'
import { VFS_PREFIX } from './config.js'
import { createCdnVfsProxy } from './cdn/vfs_proxy.js'
const SAB_SIZE = 4 * 1024 * 1024

let vfs = null
let opfsReady = false
const portHandlers = new Map()

function acquireTabLock() {
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

function handleVfsPort(port) {
  port.onmessage = async ({ data }) => {
    switch (data.op) {
      case 'read': {
        const path = data.path?.replace(/^\/+/, '') || ''
        const bytes = vfs.read(path)
        port.postMessage({ id: data.id, bytes: bytes ? [...bytes] : null })
        break
      }
      case 'write': {
        vfs.write(data.path?.replace(/^\/+/, '') || '', new Uint8Array(data.bytes || []))
        port.postMessage({ id: data.id })
        break
      }
      case 'acquire_lock': {
        const lockId = vfs.acquireLock(data.prefix || '')
        port.postMessage({ id: data.id, lockId })
        break
      }
      case 'release_lock': {
        vfs.releaseLock(data.lockId)
        port.postMessage({ id: data.id })
        break
      }
      case 'delete': {
        const path = data.path?.replace(/^\/+/, '') || ''
        const ok = vfs.delete ? vfs.delete(path) : false
        port.postMessage({ id: data.id, ok })
        break
      }
    }
  }
}

export function registerWorkerVfsPort(port) {
  if (vfs) handleVfsPort(port)
}

export function getVfsRead(path) {
  const p = path.startsWith('/') ? path.slice(1) : path
  return vfs ? vfs.read(p) : null
}

export function setupVirtualPort(port, handler) {
  portHandlers.set(port, handler)
  const swSab = new SharedArrayBuffer(SAB_SIZE)
  const handSab = new SharedArrayBuffer(SAB_SIZE)
  const { port1, port2 } = new MessageChannel()

  port1.onmessage = ({ data }) => {
    if (data.type === 'handle_request') {
      const cb = portHandlers.get(data.port)
      const res = {
        statusCode: 200,
        _headers: {},
        _done: false,
        setHeader(k, v) { this._headers[k] = v },
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
        if (cb) cb(data.request, res)
        else res.end('No handler')
      } catch (e) {
        res.statusCode = 500
        res.end(String(e))
      }
    }
  }

  const tcpWorker = new Worker('/js/tcp_worker.js', { type: 'module' })
  tcpWorker.postMessage({ sw_sab: swSab, hand_sab: handSab })

  const handlerWorker = new Worker('/js/handler_worker.js', { type: 'module' })
  handlerWorker.postMessage({ hand_sab: handSab, mainPort: port2, port }, [port2])

  handlerWorker.postMessage({ type: 'run' })

  navigator.serviceWorker.controller?.postMessage({ type: 'register_port', port, buffer: swSab })
}

export function createServer(handler) {
  return {
    listen(port) {
      setupVirtualPort(port, (req, res) => {
        const url = new URL(req.url)
        req.path = url.pathname.replace(/^\/__port__\/\d+/, '') || '/'
        handler(req, res)
      })
    }
  }
}

async function bootstrap() {
  const reg = await navigator.serviceWorker.register('/sw.js')
  if (!crossOriginIsolated) {
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
    location.reload()
    return
  }

  await acquireTabLock()

  initOpfsBridge('/js/opfs_worker.js')
  vfs = new RamVfs(opfsWrite, opfsDelete)
  opfsReady = true

  let results = []
  try {
    results = await Promise.race([
      opfsListAll(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('OPFS timeout')), 3000))
    ])
  } catch (e) {
    console.warn('[bootstrap] opfsListAll:', e?.message ?? e)
  }
  for (const { path, content } of results) {
    vfs.preload(path, content)
  }

  createBroadcastChannel(path => vfs?.invalidate(path))

  const sw = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Service Worker timeout')), 5000))
  ]).catch(e => {
    console.warn('[bootstrap] SW ready:', e?.message ?? e)
    return null
  })
  if (sw?.active) sw.active.postMessage({ type: 'VFS_READY' })

  const cdnProxy = createCdnVfsProxy(getVfsRead, (p, b) => vfs?.write(p, b))
  navigator.serviceWorker.addEventListener('message', async ({ data }) => {
    if (data.type === 'vfs_request') {
      let bytes = getVfsRead(data.path)
      if (!bytes) bytes = await cdnProxy.read(data.path)
      navigator.serviceWorker.controller?.postMessage({ type: 'vfs_response', requestId: data.requestId, bytes: bytes ? [...bytes] : null })
    }
  })

  globalThis.__vfsRead = getVfsRead
  globalThis.__vfsWrite = (path, bytes) => vfs?.write(path, bytes)

  return { vfs, VFS_PREFIX, createServer, setupVirtualPort }
}

export { bootstrap, RamVfs }
