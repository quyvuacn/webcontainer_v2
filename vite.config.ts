/// <reference types="node" />
import { defineConfig } from 'vite'

export default defineConfig(() => {
  const vfsPrefix = process.env.VITE_VFS_PREFIX || '__r__'
  return {
    appType: 'mpa',
    define: {
      'import.meta.env.VITE_VFS_PREFIX': JSON.stringify(vfsPrefix),
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.json'],
    },
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    publicDir: 'public',
    plugins: [
      {
        name: 'js-to-ts-fallback',
        configureServer(server) {
          server.middlewares.use((req: { url?: string }, _res, next) => {
            const u = req.url ?? ''
            const p = u.split('?')[0] ?? ''
            if (p.startsWith('/js/') && p.endsWith('.js') && !p.includes('node_modules')) {
              req.url = p.slice(0, -3) + '.ts' + (u.includes('?') ? u.slice(u.indexOf('?')) : '')
            }
            next()
          })
        },
      },
    ],
  }
})
