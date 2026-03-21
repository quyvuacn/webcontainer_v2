const mainClients = new Map()
const pendingVfs = new Map()
const registeredPorts = new Set()
const pendingVirtualTcp = new Map()

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
    registeredPorts.add(data.port)
    mainClients.set(source.id, source)
  }
  if (data.type === 'virtual_tcp_response') {
    const pending = pendingVirtualTcp.get(data.requestId)
    if (pending) {
      pendingVirtualTcp.delete(data.requestId)
      const body = data.body ? new Uint8Array(data.body) : new Uint8Array(0)
      const headers = data.headers ? Object.fromEntries(data.headers) : {}
      headers['Cross-Origin-Opener-Policy'] = 'same-origin'
      headers['Cross-Origin-Embedder-Policy'] = 'require-corp'
      pending.resolve(new Response(body, { status: data.status || 200, headers }))
    }
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
    const hasPort = registeredPorts.has(port)
    const portList = [...registeredPorts]
    if (hasPort) {
      event.respondWith((async () => {
        const client = mainClients.values().next().value ?? (await self.clients.matchAll())[0]
        if (!client) return new Response('No main client. Open / first.', { status: 503 })
        return forwardToMain(event.request, port, client)
      })())
      return
    }
    const errMsg = `Port ${port} not registered. Registered: [${portList.join(',') || 'none'}]. Run your server in the terminal first.`
    if (event.request.destination === 'document') {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:20px;font-family:monospace;color:#8b949e;background:#0d1117"><pre>${errMsg}</pre></body></html>`
      const h = { 'Content-Type': 'text/html;charset=utf-8', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
      event.respondWith(new Response(html, { status: 200, headers: h }))
    } else {
      event.respondWith(new Response(errMsg, { status: 503 }))
    }
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

async function forwardToMain(request, port, client) {
  const requestId = crypto.randomUUID()
  const headers = []
  request.headers.forEach((v, k) => headers.push([k, v]))
  const body = await request.arrayBuffer()
  return new Promise(resolve => {
    pendingVirtualTcp.set(requestId, { resolve })
    client.postMessage({
      type: 'virtual_tcp_request',
      requestId,
      port,
      method: request.method,
      url: request.url,
      headers,
      body: body.byteLength ? [...new Uint8Array(body)] : null
    })
    setTimeout(() => {
      if (pendingVirtualTcp.has(requestId)) {
        pendingVirtualTcp.delete(requestId)
        resolve(new Response('Gateway Timeout: main did not respond in 30s', { status: 504 }))
      }
    }, 30000)
  })
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
