import { parseRange, satisfies } from './semver'

async function fetchPackument(name: string) {
  const r = await fetch(`https://registry.npmjs.org/${name}`)
  if (!r.ok) throw new Error(`npm ERR! ${name}: ${r.status}`)
  return r.json()
}

function pickVersion(packument: { versions?: Record<string, { dependencies?: Record<string, string>; dist?: { tarball?: string } }> }, rangeStr: string) {
  const versions = Object.keys(packument.versions || {}).filter(v => !v.includes('-'))
  if (!versions.length) throw new Error(`No versions for ${packument.name}`)
  const range = parseRange(rangeStr)
  for (const v of versions.sort().reverse()) {
    if (satisfies(v, range)) return v
  }
  throw new Error(`No version satisfies ${rangeStr} for ${packument.name}`)
}

export async function resolveAll(deps: Record<string, string> | null | undefined, flags: object = {}) {
  const lock = { packages: {} as Record<string, { version: string; resolved?: string }>, lockfileVersion: 3 }
  const queue = Object.entries(deps || {})
  const seen = new Set<string>()

  while (queue.length) {
    const batch = queue.splice(0, 6)
    const results = await Promise.all(batch.map(([name]) => fetchPackument(name)))
    for (let i = 0; i < batch.length; i++) {
      const [name, rangeStr] = batch[i]
      if (seen.has(name)) continue
      seen.add(name)
      const packument = results[i]
      const version = pickVersion(packument, rangeStr)
      const manifest = packument.versions[version]
      lock.packages[`node_modules/${name}`] = { version, resolved: manifest.dist?.tarball }
      for (const [dep, dr] of Object.entries(manifest.dependencies || {})) {
        if (!seen.has(dep)) queue.push([dep, dr])
      }
    }
  }
  return lock
}
