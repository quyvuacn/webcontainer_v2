export function createShellVfsAdapter(ramVfs) {
  const prefix = (p) => (p.startsWith('/') ? p.slice(1) : p)

  return {
    async readFile(path, enc) {
      const p = prefix(path)
      const bytes = ramVfs.read(p)
      if (!bytes) throw { code: 'ENOENT', path: p }
      const content = new Uint8Array(bytes)
      return enc === 'utf8' ? new TextDecoder().decode(content) : content
    },

    async writeFile(path, content) {
      ramVfs.write(prefix(path), typeof content === 'string' ? content : content)
    },

    async readdir(path) {
      const p = prefix(path)
      const names = new Set()
      for (const key of ramVfs.files.keys()) {
        if (key === p) continue
        if (key.startsWith(p + '/')) {
          const rest = key.slice(p.length + 1)
          const name = rest.split('/')[0]
          if (name) names.add(name)
        }
      }
      for (const d of ramVfs.dirs) {
        if (d === p) continue
        if (d.startsWith(p + '/')) {
          const rest = d.slice(p.length + 1)
          const name = rest.split('/')[0]
          if (name) names.add(name)
        }
      }
      if (p && !ramVfs.exists(p)) {
        const parent = p.replace(/\/[^/]+$/, '')
        if (!parent || ramVfs.files.has(p)) throw { code: 'ENOENT', path: p }
      }
      return [...names].sort()
    },

    async stat(path) {
      const p = prefix(path)
      const entry = ramVfs.files.get(p)
      if (entry) {
        return {
          isFile: () => true,
          isDirectory: () => false,
          size: entry.content?.length ?? 0,
          mtime: new Date(entry.mtime || 0),
          mode: entry.mode ?? 0o644,
        }
      }
      if (ramVfs.dirs.has(p)) {
        return {
          isFile: () => false,
          isDirectory: () => true,
          size: 4096,
          mtime: new Date(0),
          mode: 0o755,
        }
      }
      if (ramVfs.files.has(p) || ramVfs.dirs.has(p)) return null
      throw { code: 'ENOENT', path: p }
    },

    async exists(path) {
      return ramVfs.exists(prefix(path))
    },

    async mkdir(path, opts = {}) {
      const p = prefix(path).split('/').filter(Boolean).join('/')
      const parts = p.split('/')
      for (let i = 1; i <= parts.length; i++) {
        ramVfs.dirs.add(parts.slice(0, i).join('/'))
      }
    },

    async unlink(path) {
      const p = prefix(path)
      if (!ramVfs.files.has(p)) throw { code: 'ENOENT', path: p }
      ramVfs.files.delete(p)
    },

    async rmdir(path, opts = {}) {
      const p = prefix(path)
      if (!ramVfs.dirs.has(p)) throw { code: 'ENOENT', path: p }
      if (opts.recursive) {
        const toDel = [...ramVfs.dirs].filter(d => d === p || d.startsWith(p + '/'))
        for (const d of toDel.sort((a, b) => b.length - a.length)) {
          ramVfs.dirs.delete(d)
        }
        for (const f of ramVfs.files.keys()) {
          if (f === p || f.startsWith(p + '/')) ramVfs.files.delete(f)
        }
      } else {
        const hasChild = [...ramVfs.files.keys(), ...ramVfs.dirs].some(k =>
          k.startsWith(p + '/') && k.slice(p.length + 1).split('/').length === 1
        )
        if (hasChild) throw { code: 'ENOTEMPTY', path: p }
        ramVfs.dirs.delete(p)
      }
    },

    async copyFile(src, dest) {
      const s = prefix(src)
      const d = prefix(dest)
      const bytes = ramVfs.read(s)
      if (!bytes) throw { code: 'ENOENT', path: s }
      ramVfs.write(d, bytes)
    },

    async rename(src, dest) {
      const s = prefix(src)
      const d = prefix(dest)
      const entry = ramVfs.files.get(s)
      if (entry) {
        ramVfs.write(d, entry.content)
        ramVfs.files.delete(s)
        return
      }
      if (ramVfs.dirs.has(s)) {
        ramVfs.dirs.add(d)
        for (const [k, v] of ramVfs.files) {
          if (k.startsWith(s + '/')) {
            ramVfs.files.set(d + k.slice(s.length), v)
            ramVfs.files.delete(k)
          }
        }
        for (const dir of ramVfs.dirs) {
          if (dir.startsWith(s + '/')) ramVfs.dirs.add(d + dir.slice(s.length))
        }
        ramVfs.dirs.delete(s)
        return
      }
      throw { code: 'ENOENT', path: s }
    },

    async chmod(path, mode) {
      const p = prefix(path)
      const entry = ramVfs.files.get(p)
      if (!entry) throw { code: 'ENOENT', path: p }
      entry.mode = mode & 0o777
    },
  }
}
