const mainClients = new Map()
const pendingVfs = new Map()
const portBuffers = new Map()

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open('static-v3').then(c => c.addAll([
      '/',
      '/index.html',
      '/js/vfs_ram.js',
      '/js/opfs_bridge.js',
      '/js/opfs_worker.js',
      '/js/config.js',
      '/js/main.js',
      '/js/app.js',
      '/js/http_serialize.js',
      '/js/tcp_worker.js',
      '/js/handler_worker.js',
      '/js/child_process_browser.js',
      '/js/child_worker.js',
      '/js/npm/semver.js',
      '/js/npm/resolver.js',
      '/js/npm/install.js',
      '/js/npm/ci.js',
      '/js/npm/run.js',
      '/js/npm/update.js',
      '/js/cdn/resolver.js',
      '/js/cdn/vfs_proxy.js',
      '/js/cjs_loader.js',
      '/js/shell/path.js',
      '/js/shell/parser.js',
      '/js/shell/commands.js',
      '/js/shell/shell.js',
      '/js/shell/vfs_adapter.js'
    ]).then(() => {}).catch(() => {}))
  )
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('message', ({ data, source }) => {
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting()
    return
  }
  if (data.type === 'VFS_READY') {
    mainClients.set(source.id, source)
  }
  if (data.type === 'register_port') {
    portBuffers.set(data.port, data.buffer)
  }
  if (data.type === 'vfs_response') {
    const resolve = pendingVfs.get(data.requestId)
    if (resolve) {
      pendingVfs.delete(data.requestId)
      resolve(data.bytes)
    }
  }
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)

  if (url.pathname.startsWith('/runtime/') || url.pathname === '/sw.js') {
    event.respondWith(caches.match(event.request).then(r => r ?? fetch(event.request)))
    return
  }

  if (event.request.destination === 'document') {
    event.respondWith(injectIsolationHeaders(event.request))
    return
  }

  if (url.pathname.startsWith('/__r__/')) {
    event.respondWith(serveVfsFile(url.pathname.replace(/^\/__r__\/?/, ''), event.clientId))
    return
  }

  const portMatch = url.pathname.match(/^\/__port__\/(\d+)(\/.*|$)/)
  if (portMatch) {
    const port = parseInt(portMatch[1])
    const buf = portBuffers.get(port)
    if (buf) {
      event.respondWith(handleVirtualTcp(event.request, buf))
      return
    }
  }

  event.respondWith(fetch(event.request))
})

async function injectIsolationHeaders(request) {
  const resp = await fetch(request)
  const h = new Headers(resp.headers)
  h.set('Cross-Origin-Opener-Policy', 'same-origin')
  h.set('Cross-Origin-Embedder-Policy', 'require-corp')
  return new Response(resp.body, { status: resp.status, headers: h })
}

async function serializeRequest(request) {
  const headers = []
  request.headers.forEach((v, k) => headers.push([k, v]))
  const meta = JSON.stringify({ method: request.method, url: request.url, headers })
  const metaBytes = new TextEncoder().encode(meta)
  const body = await request.arrayBuffer()
  const out = new Uint8Array(4 + metaBytes.length + body.byteLength)
  new DataView(out.buffer).setUint32(0, metaBytes.length, true)
  out.set(metaBytes, 4)
  out.set(new Uint8Array(body), 4 + metaBytes.length)
  return out
}

function deserializeResponse(bytes) {
  const metaLen = new DataView(bytes.buffer).getUint32(0, true)
  const meta = JSON.parse(new TextDecoder().decode(bytes.slice(4, 4 + metaLen)))
  const body = bytes.slice(4 + metaLen)
  return new Response(body, { status: meta.status || 200, headers: Object.fromEntries(meta.headers || []) })
}

async function handleVirtualTcp(request, buf) {
  if (request.headers.get('upgrade') === 'websocket') {
    const { 0: client, 1: server } = new WebSocketPair()
    bridgeWebSocket(server, buf)
    return new Response(null, { status: 101, webSocket: client })
  }

  const ctrl = new Int32Array(buf)
  const data = new Uint8Array(buf)
  const DATA_OFF = 12

  const reqBytes = await serializeRequest(request)
  data.set(reqBytes, DATA_OFF)
  Atomics.store(ctrl, 1, reqBytes.length)
  Atomics.store(ctrl, 0, 1)
  Atomics.notify(ctrl, 0)

  Atomics.wait(ctrl, 0, 1)

  const respLen = Atomics.load(ctrl, 2)
  const respBytes = data.slice(DATA_OFF + reqBytes.length, DATA_OFF + reqBytes.length + respLen)
  Atomics.store(ctrl, 0, 0)
  return deserializeResponse(respBytes)
}

function bridgeWebSocket(ws, buf) {
  const ctrl = new Int32Array(buf)
  const data = new Uint8Array(buf)
  const DATA_OFF = 12
  if (ws.accept) ws.accept()

  ws.addEventListener('message', ({ data: msg }) => {
    const bytes = typeof msg === 'string' ? new TextEncoder().encode(msg) : new Uint8Array(msg)
    const isText = typeof msg === 'string'
    data.set(bytes, DATA_OFF)
    Atomics.store(ctrl, 1, bytes.length)
    Atomics.store(ctrl, 2, isText ? 0 : 1)
    Atomics.store(ctrl, 0, 1)
    Atomics.notify(ctrl, 0)
  })

  ws.addEventListener('close', () => {
    Atomics.store(ctrl, 2, 2)
    Atomics.store(ctrl, 0, 1)
    Atomics.notify(ctrl, 0)
  })

  ;(async () => {
    while (true) {
      const result = Atomics.waitAsync(ctrl, 0, 0)
      await (result.value ?? Promise.resolve())
      if (Atomics.load(ctrl, 0) !== 2) continue
      const len = Atomics.load(ctrl, 1)
      const msgType = Atomics.load(ctrl, 2)
      const bytes = data.slice(DATA_OFF, DATA_OFF + len)
      if (msgType === 2) { ws.close(); break }
      ws.send(msgType === 0 ? new TextDecoder().decode(bytes) : bytes)
      Atomics.store(ctrl, 0, 0)
      Atomics.notify(ctrl, 0)
    }
  })()
}

async function serveVfsFile(path, clientId) {
  const client = mainClients.get(clientId) ?? (await self.clients.matchAll())[0]
  if (!client) return new Response('VFS not ready', { status: 503 })

  return new Promise(resolve => {
    const requestId = crypto.randomUUID()
    pendingVfs.set(requestId, bytes => {
      if (bytes === null || bytes === undefined) {
        resolve(new Response('Not found', { status: 404 }))
        return
      }
      const arr = new Uint8Array(bytes)
      const isJs = /\.(m?js|cjs|ts|tsx|jsx)$/.test(path) || path.includes('builtin')
      resolve(new Response(arr, {
        headers: { 'Content-Type': isJs ? 'application/javascript' : 'application/octet-stream' }
      }))
    })
    client.postMessage({ type: 'vfs_request', requestId, path })
  })
}
