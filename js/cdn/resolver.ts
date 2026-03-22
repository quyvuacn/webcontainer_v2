import { CDN_BASE } from './config'

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

/** Collect all concrete file paths declared in a package's exports/main/module fields. */
function collectExportedFilePaths(pkg: Record<string, unknown>): string[] {
  const paths = new Set<string>()
  function walk(node: unknown) {
    if (typeof node === 'string') {
      const p = node.startsWith('./') ? node.slice(2) : node
      // Only JS-like files, no wildcards
      if (!p.includes('*') && /\.(js|mjs|cjs)$/.test(p)) paths.add(p)
      return
    }
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node && typeof node === 'object') Object.values(node as Record<string, unknown>).forEach(walk)
  }
  if (pkg.exports) walk(pkg.exports)
  if (pkg.module && typeof pkg.module === 'string') walk(pkg.module)
  return [...paths]
}

/** Fetch all JS files declared in a package's exports field (for packages needing multi-file access). */
export async function fetchExportedFilesFromCdn(pkgName: string, version: string, realPkg: Record<string, unknown>): Promise<{ path: string; bytes: Uint8Array }[]> {
  const filePaths = collectExportedFilePaths(realPkg).slice(0, 30) // cap at 30 files
  const results = await Promise.allSettled(
    filePaths.map(async (filePath) => {
      const res = await fetch(`${CDN_BASE}/${pkgName}@${version}/${filePath}`)
      if (!res.ok) throw new Error(`not ok`)
      return { path: filePath, bytes: new Uint8Array(await res.arrayBuffer()) }
    })
  )
  return results.flatMap(r => r.status === 'fulfilled' ? [r.value] : [])
}

export async function fetchEntryFromCdn(pkgName: string, version: string) {
  const r = await fetch(`${CDN_BASE}/${pkgName}@${version}/package.json`)
  if (!r.ok) throw new Error(`CDN: ${pkgName}@${version} not found`)
  const pkg = await r.json()
  const exp = pkg.exports || pkg.main
  const rawEntry = resolveExports(exp || { '.': pkg.main || 'index.js' }, '.') || pkg.main || 'index.js'
  // Strip leading ./ to avoid OPFS treating "." as a directory segment
  const entry = rawEntry.startsWith('./') ? rawEntry.slice(2) : rawEntry
  const url = `${CDN_BASE}/${pkgName}@${version}/${entry}`
  const r2 = await fetch(url)
  if (!r2.ok) throw new Error(`CDN fetch failed: ${url}`)
  return { entry, bytes: new Uint8Array(await r2.arrayBuffer()), pkg: pkg as Record<string, unknown> }
}
