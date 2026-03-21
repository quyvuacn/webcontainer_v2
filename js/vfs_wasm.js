/**
 * WasmVfsAdapter — wrap WASM VFS exports to RamVfs-like interface.
 * Used when /runtime/vfs_ram.js loads successfully.
 */

export function createWasmVfsAdapter(wasm) {
  const prefix = (p) => (p.startsWith('/') ? p.slice(1) : p)

  return {
    read(path) {
      const b = wasm.vfs_read(prefix(path))
      return b ? new Uint8Array(b) : null
    },

    write(path, content) {
      const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(String(content))
      wasm.vfs_write(prefix(path), bytes)
    },

    delete(path) {
      return wasm.vfs_delete(prefix(path))
    },

    preload(path, content) {
      const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(String(content))
      wasm.vfs_preload(prefix(path), bytes)
    },

    invalidate(path) {
      wasm.vfs_invalidate(prefix(path))
    },

    exists(path) {
      return wasm.vfs_exists(prefix(path))
    },

    readdir(dirPath) {
      const arr = wasm.vfs_readdir(prefix(dirPath || ''))
      return Array.from(arr).map((n) => String(n))
    },

    stat(path) {
      const s = wasm.vfs_stat(prefix(path))
      if (!s || s === null) return null
      return {
        isFile: () => !!s.is_file,
        isDirectory: () => !!s.is_dir,
        size: Number(s.size ?? 0),
        mtime: new Date(Number(s.mtime ?? 0)),
        mode: 0o644,
      }
    },

    mkdir(path) {
      wasm.vfs_mkdir(prefix(path))
    },

    acquireLock(prefixPath) {
      return Number(wasm.vfs_acquire_lock(prefixPath))
    },

    releaseLock(id) {
      wasm.vfs_release_lock(id)
    },

    watch(path, recursive, callback) {
      return Number(wasm.vfs_watch(prefix(path), recursive, callback))
    },

    unwatch(id) {
      return wasm.vfs_unwatch(id)
    },

    removePrefix(prefixPath) {
      wasm.vfs_remove_prefix(prefixPath)
    },

    rename(src, dest) {
      const sp = prefix(src)
      const dp = prefix(dest)
      const b = wasm.vfs_read(sp)
      if (b) {
        wasm.vfs_write(dp, new Uint8Array(b))
        wasm.vfs_delete(sp)
        return
      }
      const st = wasm.vfs_stat(sp)
      if (st && st.is_dir) {
        const all = wasm.vfs_list_all_paths()
        const under = [...all].filter((p) => p === sp || p.startsWith(sp + '/'))
        wasm.vfs_mkdir(dp)
        for (const p of under.sort((a, b) => b.length - a.length)) {
          if (p !== sp) {
            const rest = p.slice(sp.length + 1)
            const newPath = dp + '/' + rest
            const bytes = wasm.vfs_read(p)
            if (bytes) {
              wasm.vfs_write(newPath, new Uint8Array(bytes))
              wasm.vfs_delete(p)
            }
          }
        }
        wasm.vfs_remove_prefix(sp)
      } else {
        throw new Error('ENOENT')
      }
    },
  }
}

export async function initWasmVfs() {
  const url = `${location.origin}/runtime/vfs_ram.js`
  const mod = await import(/* @vite-ignore */ url)
  const init = mod.default ?? mod
  const wasm = await init()
  return createWasmVfsAdapter(wasm)
}
