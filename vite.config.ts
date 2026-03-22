/// <reference types="node" />
import { defineConfig } from 'vite'

export default defineConfig(() => {
  const vfsPrefix = process.env.VITE_VFS_PREFIX || '__r__'
  // CDN_BASE: use same-origin /pkg proxy in dev so COEP/CORS never block requests.
  // In production, set VITE_CDN_BASE to your deployed proxy URL.
  const cdnBase = process.env.VITE_CDN_BASE || '/pkg'
  const proxyTarget = process.env.PKG_PROXY_URL || 'http://localhost:4873'
  return {
    appType: 'mpa',
    define: {
      'import.meta.env.VITE_VFS_PREFIX': JSON.stringify(vfsPrefix),
      'import.meta.env.VITE_CDN_BASE': JSON.stringify(cdnBase),
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.json'],
    },
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
      proxy: {
        // Forward /pkg/* → proxy server (same-origin, no CORS/COEP issues)
        '/pkg': {
          target: proxyTarget,
          rewrite: (path) => path.replace(/^\/pkg/, ''),
          changeOrigin: true,
        },
      },
    },
    publicDir: 'public',
    plugins: [
      {
        name: 'js-to-ts-fallback',
        configureServer(server) {
          const mw = (req: { url?: string }, res: { setHeader?: (k: string, v: string) => void }, next: () => void) => {
            const u = req.url ?? ''
            const p = u.split('?')[0] ?? ''
            if (p === '/sw.js' && res.setHeader) {
              res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
              res.setHeader('Pragma', 'no-cache')
            }
            if (p.startsWith('/js/') && p.endsWith('.js') && !p.includes('node_modules')) {
              req.url = p.slice(0, -3) + '.ts' + (u.includes('?') ? u.slice(u.indexOf('?')) : '')
            }
            next()
          }
          server.middlewares.stack.unshift({ route: '', handle: mw } as { route: string; handle: (req: unknown, res: unknown, next: () => void) => void })
        },
      },
    ],
  }
})
