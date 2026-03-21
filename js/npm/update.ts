import { resolveAll } from './resolver'
import { parseRange, satisfies } from './semver'

async function fetchLatestInRange(name: string, rangeStr: string) {
  const r = await fetch(`https://registry.npmjs.org/${name}`)
  if (!r.ok) throw new Error(`npm ERR! ${name}: ${r.status}`)
  const packument = await r.json()
  const versions = Object.keys(packument.versions || {}).filter(v => !v.includes('-')).sort().reverse()
  const range = parseRange(rangeStr)
  for (const v of versions) {
    if (satisfies(v, range)) return v
  }
  return null
}

export async function npmUpdate(vfsRead: (p: string) => Uint8Array | null, vfsWrite: (p: string, b: Uint8Array) => void, vfsAcquireLock: (p: string) => number, vfsReleaseLock: (id: number) => void, pkgPath = 'project') {
  const pkgBytes = vfsRead(`${pkgPath}/package.json`)
  if (!pkgBytes) throw new Error('No package.json')
  const pkg = JSON.parse(new TextDecoder().decode(pkgBytes))
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  if (!Object.keys(deps).length) return { updated: 0 }

  const updates: Record<string, string> = {}
  for (const [name, rangeStr] of Object.entries(deps)) {
    const latest = await fetchLatestInRange(name, rangeStr)
    if (latest) updates[name] = latest
  }

  const newDeps: Record<string, string> = {}
  for (const [n, r] of Object.entries(deps)) {
    newDeps[n] = updates[n] ? `^${updates[n]}` : r
  }
  const lock = await resolveAll(newDeps)
  const lockId = vfsAcquireLock(`${pkgPath}/node_modules`)
  for (const [path, entry] of Object.entries(lock.packages)) {
    const pkgName = path.replace('node_modules/', '')
    vfsWrite(`${pkgPath}/${path}/package.json`, new TextEncoder().encode(JSON.stringify({ name: pkgName, version: entry.version, main: 'index.js' })))
  }
  vfsReleaseLock(lockId)
  vfsWrite(`${pkgPath}/package-lock.json`, new TextEncoder().encode(JSON.stringify(lock, null, 2)))

  const changed = Object.keys(updates).length
  return { updated: changed }
}
