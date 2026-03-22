const mainClients = new Map()
const pendingVfs = new Map()
const portMainChannels = new Map()

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open('static-v5').then(c => c.addAll([
      '/',
      '/index.html',
      '/sample_vite.json',
      '/js/vfs_ram.ts',
      '/js/opfs_bridge.ts',
      '/js/opfs_worker.ts',
      '/js/config.ts',
      '/js/main.ts',
      '/js/app.ts',
      '/js/http_serialize.ts',
      '/js/tcp_worker.ts',
      '/js/handler_worker.ts',
      '/js/worker_threads_runner.ts',
      '/js/child_process_browser.ts',
      '/js/child_worker.ts',
      '/js/npm/semver.ts',
      '/js/npm/resolver.ts',
      '/js/npm/install.ts',
      '/js/npm/ci.ts',
      '/js/npm/run.ts',
      '/js/npm/update.ts',
      '/js/cdn/resolver.ts',
      '/js/cdn/vfs_proxy.ts',
      '/js/cjs_loader.ts',
      '/js/shell/path.ts',
      '/js/shell/parser.ts',
      '/js/shell/commands.ts',
      '/js/shell/shell.ts',
      '/js/shell/vfs_adapter.ts'
    ]).then(() => {}).catch(() => {}))
  )
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

async function handleJsRequest(request) {
  const isLocalhost = new URL(request.url).hostname === 'localhost' || new URL(request.url).hostname === '127.0.0.1'
  if (isLocalhost) {
    try {
      let resp = await fetch(request, { cache: 'reload' })
      if (resp.ok) return resp
      const url = new URL(request.url)
      if (resp.status === 404 && url.pathname.endsWith('.js')) {
        resp = await fetch(new URL(url.pathname.slice(0, -3) + '.ts' + url.search, url.origin), { cache: 'reload' })
      }
      if (resp.ok) return resp
    } catch {}
  }
  const cached = await caches.match(request)
  if (cached) return cached
  return fetch(request)
}

self.addEventListener('message', ({ data, source }) => {
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting()
    return
  }
  if (data.type === 'VFS_READY') {
    mainClients.set(source.id, source)
  }
  if (data.type === 'register_port') {
    const port = data.port
    const mainPort = data.mainPort
    if (mainPort) portMainChannels.set(port, mainPort)
    if (data.ackPort) { data.ackPort.postMessage('ok'); data.ackPort.close() }
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

  if (url.pathname.startsWith('/runtime/') || url.pathname === '/sw.js' || url.pathname.startsWith('/js/')) {
    event.respondWith(handleJsRequest(event.request))
    return
  }

  const portMatch = url.pathname.match(/^\/__port__\/(\d+)(\/.*|$)/)
  if (portMatch) {
    const port = parseInt(portMatch[1])
    const mainPort = portMainChannels.get(port)
    if (mainPort) {
      event.respondWith(handleVirtualTcpViaMain(event.request, port, mainPort))
      return
    }
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Port :${port}</title></head><body style="margin:0;padding:16px;font-family:system-ui;background:#0d1117;color:#c9d1d9"><h2>Port :${port} chưa sẵn sàng</h2><p>Chạy <code style="background:#21262d;padding:2px 6px">node server.js</code> trong terminal.</p><button id="btn" style="margin-top:12px;padding:8px 16px;background:#238636;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px">Chạy server</button><script>document.getElementById("btn").onclick=()=>{if(window.parent!==window)window.parent.postMessage({type:"run-preview-cmd",cmd:"node server.js"},"*")}</script></body></html>`
    event.respondWith(new Response(html, { status: 503, headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } }))
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

  event.respondWith(fetch(event.request))
})

async function injectIsolationHeaders(request) {
  const isLocalhost = new URL(request.url).hostname === 'localhost' || new URL(request.url).hostname === '127.0.0.1'
  const resp = await fetch(request, isLocalhost ? { cache: 'reload' } : {})
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

async function handleVirtualTcpViaMain(request, port, mainPort) {
  if (request.headers.get('upgrade') === 'websocket') {
    const { 0: client, 1: server } = new WebSocketPair()
    return new Response('WebSocket via Main not implemented', { status: 501 })
  }
  const reqBytes = await serializeRequest(request)
  const { port1: respIn, port2: respOut } = new MessageChannel()
  const p = new Promise((resolve, reject) => {
    let done = false
    const td = setTimeout(() => {
      if (!done) { done = true; respIn.close(); reject(new Error('timeout')) }
    }, 30000)
    respIn.onmessage = ({ data }) => {
      if (done) return
      done = true
      clearTimeout(td)
      respIn.close()
      if (data.error) reject(new Error(data.error))
      else resolve(deserializeResponse(new Uint8Array(data.responseBytes)))
    }
    respIn.onmessageerror = () => { if (!done) { done = true; clearTimeout(td); respIn.close(); reject(new Error('messageerror')) } }
  })
  mainPort.postMessage({ requestBytes: [...reqBytes], responsePort: respOut }, [respOut])
  return p
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
