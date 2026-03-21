/**
 * vfs_wasm.js — load the VFS WASM module and wrap it in a RamVfs-compatible
 * interface.
 *
 * wasm-bindgen --target web pattern:
 *   - `vfs_ram.js` exports named functions (vfs_read, vfs_write, ...)
 *     AND a default export `init` that instantiates the WASM binary.
 *   - We must call `await init()` first to load the binary, THEN call
 *     the named exports — they share the same `wasm` internal variable.
 *   - init() return value is the raw WebAssembly.Exports — do NOT use it
 *     as the function interface. Use the named module exports instead.
 */

import { opfsWrite, opfsDelete } from '/js/opfs_bridge.js'

export function createWasmVfsAdapter(mod) {
  // mod = the entire module namespace (all named exports from vfs_ram.js)
  // Inject OPFS callbacks so Rust can call them fire-and-forget.
  if (typeof mod.vfs_set_opfs_callbacks === 'function') {
    mod.vfs_set_opfs_callbacks(
      (path, bytes) => opfsWrite(path, bytes),
      (path)        => opfsDelete(path),
    )
  }

  const prefix = (p) => (p.startsWith('/') ? p.slice(1) : p)

  return {
    read(path) {
      const b = mod.vfs_read(prefix(path))
      return b ? new Uint8Array(b) : null
    },

    write(path, content) {
      const bytes = content instanceof Uint8Array
        ? content
        : new TextEncoder().encode(String(content))
      mod.vfs_write(prefix(path), bytes)
    },

    delete(path) {
      return mod.vfs_delete(prefix(path))
    },

    preload(path, content) {
      const bytes = content instanceof Uint8Array
        ? content
        : new TextEncoder().encode(String(content))
      mod.vfs_preload(prefix(path), bytes)
    },

    invalidate(path) {
      mod.vfs_invalidate(prefix(path))
    },

    exists(path) {
      return mod.vfs_exists(prefix(path))
    },

    readdir(dirPath) {
      const arr = mod.vfs_readdir(prefix(dirPath || ''))
      return Array.from(arr).map(String)
    },

    stat(path) {
      const s = mod.vfs_stat(prefix(path))
      if (!s) return null
      return {
        isFile:      () => !!s.is_file,
        isDirectory: () => !!s.is_dir,
        size:  Number(s.size  ?? 0),
        mtime: new Date(Number(s.mtime ?? 0)),
        mode:  0o644,
      }
    },

    mkdir(path) {
      mod.vfs_mkdir(prefix(path))
    },

    // wasm-bindgen generates u64 as BigInt — convert to Number for JS callers
    acquireLock(prefixPath) {
      return Number(mod.vfs_acquire_lock(prefixPath))
    },

    releaseLock(id) {
      // Accept both Number and BigInt from JS callers
      mod.vfs_release_lock(BigInt(id))
    },

    watch(path, recursive, callback) {
      return Number(mod.vfs_watch(prefix(path), recursive, callback))
    },

    unwatch(id) {
      return mod.vfs_unwatch(BigInt(id))
    },

    removePrefix(prefixPath) {
      mod.vfs_remove_prefix(prefixPath)
    },

    listAllPaths() {
      return mod.vfs_list_all_paths
        ? Array.from(mod.vfs_list_all_paths())
        : []
    },

    rename(src, dest) {
      const sp = prefix(src)
      const dp = prefix(dest)
      const bytes = mod.vfs_read(sp)
      if (bytes) {
        mod.vfs_write(dp, new Uint8Array(bytes))
        mod.vfs_delete(sp)
        return
      }
      const st = mod.vfs_stat(sp)
      if (st?.is_dir) {
        const all    = mod.vfs_list_all_paths ? Array.from(mod.vfs_list_all_paths()) : []
        const under  = all.filter(p => p === sp || p.startsWith(sp + '/'))
        mod.vfs_mkdir(dp)
        for (const p of under.sort((a, b) => b.length - a.length)) {
          if (p === sp) continue
          const rest    = p.slice(sp.length + 1)
          const newPath = dp + '/' + rest
          const b       = mod.vfs_read(p)
          if (b) {
            mod.vfs_write(newPath, new Uint8Array(b))
            mod.vfs_delete(p)
          }
        }
        mod.vfs_remove_prefix(sp)
      } else {
        throw new Error('ENOENT: ' + src)
      }
    },
  }
}

/**
 * Load and initialise the VFS WASM module.
 *
 * wasm-bindgen --target web workflow:
 *   1. dynamic import vfs_ram.js  → get module namespace (named exports)
 *   2. call default export init() → instantiates the .wasm binary
 *   3. after init(), named exports (vfs_read, vfs_write, ...) become live
 *   4. wrap named exports in adapter
 */
export async function initWasmVfs() {
  const url = new URL('/runtime/vfs_ram.js', location.origin).href

  // Step 1: import the module — gets named exports + default init fn
  const mod = await import(/* @vite-ignore */ url)

  // Step 2: call init() to load and instantiate the .wasm binary
  // Pass explicit URL so it works regardless of server base path
  const wasmUrl = new URL('/runtime/vfs_ram_bg.wasm', location.origin)
  await mod.default({ module_or_path: wasmUrl })

  // Step 3: named exports are now live — wrap them
  return createWasmVfsAdapter(mod)
}
