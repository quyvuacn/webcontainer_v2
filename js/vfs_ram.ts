export const WATCH_KIND = { Modified: 'Modified' as const, Created: 'Created' as const, Deleted: 'Deleted' as const }

export class RamVfs {
  files: Map<string, { content: Uint8Array; mtime: number; mode: number }>
  dirs: Set<string>
  watchers: { id: number; path: string; recursive: boolean; callback: (ev: { path: string; kind: string }) => void }[]
  locks: Map<string, number>
  eventBuf: { path: string; kind: string }[]
  nextWid: number
  nextLid: number
  opfsWrite: ((path: string, bytes: Uint8Array) => Promise<void>) | null
  opfsDelete: ((path: string) => Promise<void>) | null

  constructor(opfsWrite: ((path: string, bytes: Uint8Array) => Promise<void>) | null, opfsDelete: ((path: string) => Promise<void>) | null) {
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

  delete(path: string) {
    const existed = this.files.has(path)
    if (existed) {
      this.files.delete(path)
      this.maybeEmit(path, WATCH_KIND.Deleted)
      if (this.opfsDelete) this.opfsDelete(path).catch(() => {})
    }
    return existed
  }

  pathMatches(watchPath: string, changed: string, recursive: boolean) {
    const watchNorm = watchPath.replace(/\/+$/, '')
    const changedNorm = changed.replace(/\/+$/, '')
    if (recursive) {
      return changedNorm === watchNorm || changedNorm.startsWith(watchNorm + '/')
    }
    const parent = changedNorm.includes('/') ? changedNorm.replace(/\/[^/]+$/, '') : ''
    return changedNorm === watchNorm || parent === watchNorm
  }

  emitToWatchers(path: string, kind: string) {
    for (const w of this.watchers) {
      if (this.pathMatches(w.path, path, w.recursive)) {
        try {
          w.callback({ path, kind })
        } catch {}
      }
    }
  }

  maybeEmit(path: string, kind: string) {
    const locked = [...this.locks.keys()].some(p => path === p || path.startsWith(p + '/'))
    if (locked) {
      this.eventBuf.push({ path, kind })
    } else {
      this.emitToWatchers(path, kind)
    }
  }

  ensureParentDirs(path: string) {
    const parts = path.split('/').filter(Boolean)
    for (let i = 1; i < parts.length; i++) {
      this.dirs.add(parts.slice(0, i).join('/'))
    }
  }

  write(path: string, content: Uint8Array | string) {
    const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(String(content))
    const mtime = Date.now()
    this.files.set(path, { content: bytes, mtime, mode: 0o644 })
    this.ensureParentDirs(path)
    this.maybeEmit(path, WATCH_KIND.Modified)
    if (this.opfsWrite) {
      this.opfsWrite(path, bytes).catch(() => {})
    }
  }

  read(path: string) {
    const entry = this.files.get(path)
    return entry ? entry.content : null
  }

  readText(path: string) {
    const bytes = this.read(path)
    return bytes ? new TextDecoder().decode(bytes) : null
  }

  exists(path: string) {
    return this.files.has(path) || this.dirs.has(path)
  }

  readdir(dirPath: string) {
    const prefix = (dirPath || '').replace(/\/+$/, '') + (dirPath ? '/' : '')
    const names = new Set<string>()
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

  stat(path: string) {
    const entry = this.files.get(path)
    if (entry) {
      return { isFile: () => true, isDirectory: () => false, size: entry.content.length, mtime: new Date(entry.mtime || 0), mode: entry.mode ?? 0o644 }
    }
    if (this.dirs.has(path)) {
      return { isFile: () => false, isDirectory: () => true, size: 4096, mtime: new Date(0), mode: 0o755 }
    }
    return null
  }

  mkdir(path: string) {
    const parts = path.split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i++) {
      this.dirs.add(parts.slice(0, i).join('/'))
    }
  }

  preload(path: string, content: Uint8Array | string) {
    const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(String(content))
    this.files.set(path, { content: bytes, mtime: 0, mode: 0o644 })
    this.ensureParentDirs(path)
  }

  invalidate(path: string) {
    this.files.delete(path)
  }

  acquireLock(prefix: string) {
    const id = this.nextLid++
    this.locks.set(prefix, id)
    return id
  }

  releaseLock(id: number) {
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

  watch(path: string, recursive: boolean, callback: (ev: { path: string; kind: string }) => void) {
    const id = this.nextWid++
    this.watchers.push({ id, path, recursive, callback })
    return id
  }

  unwatch(id: number) {
    const i = this.watchers.findIndex(w => w.id === id)
    if (i >= 0) this.watchers.splice(i, 1)
  }
}
