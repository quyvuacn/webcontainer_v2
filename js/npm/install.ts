import { resolveAll as defaultResolveAll } from './resolver'
import { fetchEntryFromCdn } from '../cdn/resolver'

export async function npmInstall(vfsRead: (p: string) => Uint8Array | null, vfsWrite: (p: string, b: Uint8Array) => void, vfsAcquireLock: (p: string) => number, vfsReleaseLock: (id: number) => void, pkgPath = 'project', resolveAll = defaultResolveAll, opts: { prefetch?: boolean } = {}) {
  const pkgJsonBytes = vfsRead(`${pkgPath}/package.json`)
  if (!pkgJsonBytes) throw new Error('No package.json')
  const pkg = JSON.parse(new TextDecoder().decode(pkgJsonBytes))
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  if (!Object.keys(deps).length) return { added: 0 }

  const lock = await resolveAll(deps)
  const lockId = vfsAcquireLock(`${pkgPath}/node_modules`)

  for (const [path, entry] of Object.entries(lock.packages)) {
    const name = path.replace('node_modules/', '')
    const stub = JSON.stringify({ name, version: entry.version, main: 'index.js' })
    vfsWrite(`${pkgPath}/${path}/package.json`, new TextEncoder().encode(stub))
  }

  if (opts.prefetch !== false) {
    const prefetchResults = await Promise.allSettled(
      Object.entries(lock.packages).map(async ([path, entry]) => {
        const name = path.replace('node_modules/', '')
        const { entry: entryPath, bytes } = await fetchEntryFromCdn(name, entry.version)
        vfsWrite(`${pkgPath}/${path}/${entryPath}`, bytes)
      })
    )
    const failed = prefetchResults.filter((r) => r.status === 'rejected').length
    if (failed) console.warn(`npm: prefetch failed for ${failed} package(s)`)
  }

  vfsReleaseLock(lockId)
  vfsWrite(`${pkgPath}/package-lock.json`, new TextEncoder().encode(JSON.stringify(lock, null, 2)))
  return { added: Object.keys(lock.packages).length }
}
