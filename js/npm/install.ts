import { resolveAll as defaultResolveAll } from './resolver'
import { CDN_BASE } from '../cdn/config'

export async function npmInstall(vfsRead: (p: string) => Uint8Array | null, vfsWrite: (p: string, b: Uint8Array) => void, vfsAcquireLock: (p: string) => number, vfsReleaseLock: (id: number) => void, pkgPath = 'project', resolveAll = defaultResolveAll, opts: { prefetch?: boolean } = {}) {
  const pkgJsonBytes = vfsRead(`${pkgPath}/package.json`)
  if (!pkgJsonBytes) throw new Error('No package.json')
  const pkg = JSON.parse(new TextDecoder().decode(pkgJsonBytes))
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  if (!Object.keys(deps).length) return { added: 0 }

  const lock = await resolveAll(deps)
  const lockId = vfsAcquireLock(`${pkgPath}/node_modules`)

  // Fetch real package.json for each package from CDN (not a stub).
  // This ensures the correct `main`, `exports`, `bin` fields are available
  // before any code tries to resolve entry points.
  const pkgJsonResults = await Promise.allSettled(
    Object.entries(lock.packages).map(async ([path, entry]) => {
      const name = path.replace('node_modules/', '')
      const r = await fetch(`${CDN_BASE}/${name}@${entry.version}/package.json`)
      if (!r.ok) throw new Error(`CDN: ${name}@${entry.version} package.json not found`)
      const realPkgJson = await r.arrayBuffer()
      vfsWrite(`${pkgPath}/${path}/package.json`, new Uint8Array(realPkgJson))
    })
  )
  const failed = pkgJsonResults.filter((r) => r.status === 'rejected').length
  if (failed) console.warn(`npm: failed to fetch package.json for ${failed} package(s)`)

  vfsReleaseLock(lockId)
  vfsWrite(`${pkgPath}/package-lock.json`, new TextEncoder().encode(JSON.stringify(lock, null, 2)))
  return { added: Object.keys(lock.packages).length }
}
