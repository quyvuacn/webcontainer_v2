import { fetchFromCdn } from './resolver'

export function createCdnVfsProxy(vfsRead: (path: string) => Uint8Array | null, vfsWrite: (path: string, bytes: Uint8Array) => void, lockfilePath = 'project/package-lock.json') {
  return {
    async read(path: string) {
      let bytes = vfsRead(path)
      if (bytes) return bytes

      const m = path.match(/^project\/node_modules\/(.+?)\/(.+)$/) || path.match(/^project\/node_modules\/([^/]+)\/package\.json$/)
      if (m) {
        const full = m[1]
        const sub = m[2] || '.'
        const [name, version] = full.includes('@') ? full.split('@') : [full, null]
        if (!version) {
          const pkgPath = `project/node_modules/${name}/package.json`
          const pkgBytes = vfsRead(pkgPath)
          if (pkgBytes) {
            const pkg = JSON.parse(new TextDecoder().decode(pkgBytes))
            bytes = await fetchFromCdn(name, pkg.version, sub === 'package.json' ? '.' : sub)
            vfsWrite(path, bytes)
            return bytes
          }
        } else {
          bytes = await fetchFromCdn(name, version, sub === 'package.json' ? '.' : sub)
          vfsWrite(path, bytes)
          return bytes
        }
      }
      return null
    }
  }
}
