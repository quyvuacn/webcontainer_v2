export function normalize(path: unknown) {
  const p = path != null ? String(path).replace(/\\/g, '/') : ''
  if (!p) return ''
  let s = p.startsWith('/') ? p.slice(1) : p
  const parts = s.split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (stack.length) stack.pop()
    } else {
      stack.push(part)
    }
  }
  return stack.join('/')
}

export function join(...segments: (string | undefined)[]) {
  let result = ''
  for (const seg of segments) {
    if (!seg) continue
    const s = String(seg).replace(/\\/g, '/')
    if (s.startsWith('/')) {
      result = s.startsWith('/') ? s.slice(1) : s
    } else {
      result = result ? result + '/' + s : s
    }
  }
  return normalize(result || '')
}

export function dirname(path: string) {
  const n = normalize(path)
  if (!n) return ''
  const i = n.lastIndexOf('/')
  return i < 0 ? '' : n.slice(0, i)
}

export function basename(path: string, ext?: string) {
  const n = normalize(path)
  if (!n) return ''
  const parts = n.split('/')
  let base = parts[parts.length - 1] ?? ''
  if (ext && base.endsWith(ext)) base = base.slice(0, -ext.length)
  return base
}

export function extname(path: string) {
  const base = basename(path)
  const i = base.lastIndexOf('.')
  return i <= 0 ? '' : base.slice(i)
}

export function resolve(...paths: (string | null | undefined)[]) {
  let result = ''
  for (const p of paths) {
    if (p == null) continue
    const s = String(p).replace(/\\/g, '/')
    if (!s) continue
    if (s.startsWith('/')) {
      result = s.startsWith('/') ? s.slice(1) : s
    } else {
      result = result ? result + '/' + s : s
    }
  }
  return normalize(result || '')
}
