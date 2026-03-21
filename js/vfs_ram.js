const WATCH_KIND = { Modified: 'Modified', Created: 'Created', Deleted: 'Deleted' }

class RamVfs {
  constructor(opfsWrite, opfsDelete) {
    this.files = new Map()
    this.dirs = new Set()
    this.watchers = []
    this.locks = new Map()
    this.eventBuf = []
    this.nextWid = 1
    this.nextLid = 1
    this.opfsWrite = opfsWrite
    this.opfsDelete = opfsDelete
  }

  delete(path) {
    const existed = this.files.has(path)
    if (existed) {
      this.files.delete(path)
      this.maybeEmit(path, WATCH_KIND.Deleted)
      if (this.opfsDelete) this.opfsDelete(path).catch(() => {})
    }
    return existed
  }

  pathMatches(watchPath, changed, recursive) {
    const watchNorm = watchPath.replace(/\/+$/, '')
    const changedNorm = changed.replace(/\/+$/, '')
    if (recursive) {
      return changedNorm === watchNorm || changedNorm.startsWith(watchNorm + '/')
    }
    const parent = changedNorm.includes('/') ? changedNorm.replace(/\/[^/]+$/, '') : ''
    return changedNorm === watchNorm || parent === watchNorm
  }

  emitToWatchers(path, kind) {
    for (const w of this.watchers) {
      if (this.pathMatches(w.path, path, w.recursive)) {
        try {
          w.callback({ path, kind })
        } catch (_) {}
      }
    }
  }

  maybeEmit(path, kind) {
    const locked = [...this.locks.keys()].some(p => path === p || path.startsWith(p + '/'))
    if (locked) {
      this.eventBuf.push({ path, kind })
    } else {
      this.emitToWatchers(path, kind)
    }
  }

  ensureParentDirs(path) {
    const parts = path.split('/').filter(Boolean)
    for (let i = 1; i < parts.length; i++) {
      this.dirs.add(parts.slice(0, i).join('/'))
    }
  }

  write(path, content) {
    const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(String(content))
    const mtime = Date.now()
    this.files.set(path, { content: bytes, mtime, mode: 0o644 })
    this.ensureParentDirs(path)
    this.maybeEmit(path, WATCH_KIND.Modified)
    if (this.opfsWrite) {
      this.opfsWrite(path, bytes).catch(() => {})
    }
  }

  read(path) {
    const entry = this.files.get(path)
    return entry ? entry.content : null
  }

  readText(path) {
    const bytes = this.read(path)
    return bytes ? new TextDecoder().decode(bytes) : null
  }

  exists(path) {
    return this.files.has(path) || this.dirs.has(path)
  }

  readdir(dirPath) {
    const prefix = (dirPath || '').replace(/\/+$/, '') + (dirPath ? '/' : '')
    const names = new Set()
    for (const k of this.files.keys()) {
      if (k.startsWith(prefix)) {
        const rest = k.slice(prefix.length)
        const name = rest.split('/')[0]
        if (name) names.add(name)
      }
    }
    for (const d of this.dirs) {
      if (d.startsWith(prefix) && d !== dirPath) {
        const rest = d.slice(prefix.length)
        const name = rest.split('/')[0]
        if (name) names.add(name)
      }
    }
    return [...names].sort()
  }

  stat(path) {
    const entry = this.files.get(path)
    if (entry) {
      return { isFile: () => true, isDirectory: () => false, size: entry.content.length, mtime: new Date(entry.mtime || 0), mode: entry.mode ?? 0o644 }
    }
    if (this.dirs.has(path)) {
      return { isFile: () => false, isDirectory: () => true, size: 4096, mtime: new Date(0), mode: 0o755 }
    }
    return null
  }

  mkdir(path) {
    const parts = path.split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i++) {
      this.dirs.add(parts.slice(0, i).join('/'))
    }
  }

  preload(path, content) {
    const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(String(content))
    this.files.set(path, { content: bytes, mtime: 0, mode: 0o644 })
    this.ensureParentDirs(path)
  }

  invalidate(path) {
    this.files.delete(path)
  }

  acquireLock(prefix) {
    const id = this.nextLid++
    this.locks.set(prefix, id)
    return id
  }

  releaseLock(id) {
    for (const [k, v] of this.locks) {
      if (v === id) {
        this.locks.delete(k)
        break
      }
    }
    const events = this.eventBuf.splice(0)
    for (const ev of events) {
      this.emitToWatchers(ev.path, ev.kind)
    }
  }

  watch(path, recursive, callback) {
    const id = this.nextWid++
    this.watchers.push({ id, path, recursive, callback })
    return id
  }

  unwatch(id) {
    const i = this.watchers.findIndex(w => w.id === id)
    if (i >= 0) this.watchers.splice(i, 1)
  }
}

export { RamVfs, WATCH_KIND }
