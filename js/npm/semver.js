export function parseVersion(s) {
  const m = String(s).match(/^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.+)?$/)
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || '' }
}

export function parseRange(s) {
  s = String(s).trim()
  if (!s || s === '*') return { type: 'any' }
  const exact = s.match(/^(\d+\.\d+\.\d+)$/)
  if (exact) return { type: 'exact', v: parseVersion(exact[1]) }
  const caret = s.match(/^\^(\d+\.\d+\.\d+)$/)
  if (caret) return { type: 'caret', v: parseVersion(caret[1]) }
  const tilde = s.match(/^~(\d+\.\d+\.\d+)$/)
  if (tilde) return { type: 'tilde', v: parseVersion(tilde[1]) }
  const gte = s.match(/^>=?(.+)$/)
  if (gte) return { type: 'gte', v: parseVersion(gte[1]) }
  const lte = s.match(/^<=?(.+)$/)
  if (lte) return { type: 'lte', v: parseVersion(lte[1]) }
  return { type: 'tag', tag: s }
}

function cmp(a, b) {
  if (!a || !b) return 0
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  return 0
}

export function satisfies(ver, range) {
  const v = parseVersion(ver)
  if (!v) return false
  if (range.type === 'any') return true
  if (range.type === 'tag') return true
  const r = range.v
  if (!r) return false
  const c = cmp(v, r)
  if (range.type === 'exact') return c === 0
  if (range.type === 'caret') {
    if (c < 0) return false
    if (r.major > 0) return v.major === r.major
    if (r.minor > 0) return v.major === 0 && v.minor === r.minor
    return c === 0
  }
  if (range.type === 'tilde') return c >= 0 && v.major === r.major && v.minor === r.minor
  if (range.type === 'gte') return c >= 0
  if (range.type === 'lte') return c <= 0
  return false
}
