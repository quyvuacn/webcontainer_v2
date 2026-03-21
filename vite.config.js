import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => {
  const vfsPrefix = process.env.VITE_VFS_PREFIX || '__r__'
  return {
    appType: 'mpa',
    define: {
      'import.meta.env.VITE_VFS_PREFIX': JSON.stringify(vfsPrefix),
    },
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    publicDir: 'public',
  }
})
