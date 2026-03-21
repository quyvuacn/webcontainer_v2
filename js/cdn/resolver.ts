const CDN_BASE = 'https://unpkg.com'

export function resolveExports(exports: unknown, subpath: string, conditions = ['import', 'browser', 'module', 'default']): string | null {
  if (typeof exports === 'string') return subpath === '.' ? exports : null
  if (typeof exports !== 'object' || !exports) return null
  const exp = exports as Record<string, unknown>
  const exact = exp[subpath] ?? exp['./' + subpath]
  if (exact !== undefined) return resolveCondition(exact, conditions)
  for (const [pattern, target] of Object.entries(exp)) {
    const m = pattern.match(/^\.\/(.+)\*$/)
    if (m && subpath.startsWith(m[1])) {
      const r = resolveCondition(target, conditions)
      return r ? String(r).replace('*', subpath.slice(m[1].length)) : null
    }
  }
  return null
}

function resolveCondition(target: unknown, conditions: string[]): string | null {
  if (typeof target === 'string') return target
  if (Array.isArray(target)) {
    for (const t of target) {
      const r = resolveCondition(t, conditions)
      if (r) return r
    }
    return null
  }
  if (typeof target === 'object' && target) {
    for (const c of conditions) {
      if ((target as Record<string, unknown>)[c] !== undefined) return resolveCondition((target as Record<string, unknown>)[c], conditions)
    }
  }
  return null
}

export async function resolveCdnPath(pkgName: string, version: string, subpath = '.') {
  const r = await fetch(`${CDN_BASE}/${pkgName}@${version}/package.json`)
  if (!r.ok) throw new Error(`CDN: ${pkgName}@${version} not found`)
  const pkg = await r.json()
  const exp = pkg.exports || pkg.main
  const entry = resolveExports(exp || { '.': pkg.main || 'index.js' }, subpath) || pkg.main || 'index.js'
  return `${CDN_BASE}/${pkgName}@${version}/${entry}`
}

export async function fetchFromCdn(pkgName: string, version: string, subpath = '.') {
  const url = await resolveCdnPath(pkgName, version, subpath)
  const r = await fetch(url)
  if (!r.ok) throw new Error(`CDN fetch failed: ${url}`)
  return new Uint8Array(await r.arrayBuffer())
}

export async function fetchEntryFromCdn(pkgName: string, version: string) {
  const r = await fetch(`${CDN_BASE}/${pkgName}@${version}/package.json`)
  if (!r.ok) throw new Error(`CDN: ${pkgName}@${version} not found`)
  const pkg = await r.json()
  const exp = pkg.exports || pkg.main
  const entry = resolveExports(exp || { '.': pkg.main || 'index.js' }, '.') || pkg.main || 'index.js'
  const url = `${CDN_BASE}/${pkgName}@${version}/${entry}`
  const r2 = await fetch(url)
  if (!r2.ok) throw new Error(`CDN fetch failed: ${url}`)
  return { entry, bytes: new Uint8Array(await r2.arrayBuffer()) }
}
