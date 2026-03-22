import { parseRange, satisfies } from './semver'
import { CDN_BASE } from '../cdn/config'

export async function npmCi(vfsRead: (p: string) => Uint8Array | null, vfsWrite: (p: string, b: Uint8Array) => void, vfsAcquireLock: (p: string) => number, vfsReleaseLock: (id: number) => void, pkgPath = 'project', opts: { prefetch?: boolean } = {}) {
  const lockBytes = vfsRead(`${pkgPath}/package-lock.json`)
  if (!lockBytes) throw new Error('npm ERR! Missing package-lock.json\nnpm ERR! Use npm install.')

  const pkgBytes = vfsRead(`${pkgPath}/package.json`)
  if (!pkgBytes) throw new Error('No package.json')
  const pkg = JSON.parse(new TextDecoder().decode(pkgBytes))
  const lock = JSON.parse(new TextDecoder().decode(lockBytes))

  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  for (const [name, range] of Object.entries(allDeps)) {
    const entry = lock.packages[`node_modules/${name}`]
    if (!entry) throw new Error(`npm ERR! ${name} not in lockfile`)
    if (!satisfies(entry.version, parseRange(range))) {
      throw new Error(`npm ERR! ${name}@${entry.version} does not satisfy ${range}`)
    }
  }

  const lockId = vfsAcquireLock(`${pkgPath}/node_modules`)

  const pkgJsonResults = await Promise.allSettled(
    Object.entries(lock.packages).map(async ([path, entry]) => {
      const name = path.replace('node_modules/', '')
      if (name.startsWith('@types/')) {
        const stub = JSON.stringify({ name, version: entry.version, types: 'index.d.ts' })
        vfsWrite(`${pkgPath}/${path}/package.json`, new TextEncoder().encode(stub))
        return
      }
      const r = await fetch(`${CDN_BASE}/${name}@${entry.version}/package.json`)
      if (!r.ok) throw new Error(`CDN: ${name}@${entry.version} package.json not found`)
      const realPkgJson = await r.arrayBuffer()
      vfsWrite(`${pkgPath}/${path}/package.json`, new Uint8Array(realPkgJson))
    })
  )
  const failed = pkgJsonResults.filter((r) => r.status === 'rejected').length
  if (failed) console.warn(`npm: failed to fetch package.json for ${failed} package(s)`)

  vfsReleaseLock(lockId)
  return { added: Object.keys(lock.packages).length }
}
