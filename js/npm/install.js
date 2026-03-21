import { resolveAll as defaultResolveAll } from './resolver.js'
import { fetchEntryFromCdn } from '../cdn/resolver.js'

export async function npmInstall(vfsRead, vfsWrite, vfsAcquireLock, vfsReleaseLock, pkgPath = 'project', resolveAll = defaultResolveAll, opts = {}) {
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
    vfsWrite(`${pkgPath}/${path}/package.json`, stub)
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
  vfsWrite(`${pkgPath}/package-lock.json`, JSON.stringify(lock, null, 2))
  return { added: Object.keys(lock.packages).length }
}
