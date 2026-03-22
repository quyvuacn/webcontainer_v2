import { opfsWrite, opfsDelete } from "./opfs_bridge";

export function createWasmVfsAdapter(mod: Record<string, unknown>) {
  if (typeof mod.vfs_set_opfs_callbacks === "function") {
    mod.vfs_set_opfs_callbacks(
      (path: string, bytes: Uint8Array) => opfsWrite(path, bytes),
      (path: string) => opfsDelete(path),
    );
  }

  const prefix = (p: string) => (p.startsWith("/") ? p.slice(1) : p);

  return {
    read(path: string) {
      const b = mod.vfs_read(prefix(path));
      return b ? new Uint8Array(b as ArrayBuffer) : null;
    },

    write(path: string, content: Uint8Array | string) {
      const bytes =
        content instanceof Uint8Array
          ? content
          : new TextEncoder().encode(String(content));
      (mod.vfs_write as (p: string, b: Uint8Array) => void)(
        prefix(path),
        bytes,
      );
    },

    delete(path: string) {
      return (mod.vfs_delete as (p: string) => boolean)(prefix(path));
    },

    preload(path: string, content: Uint8Array | string) {
      const bytes =
        content instanceof Uint8Array
          ? content
          : new TextEncoder().encode(String(content));
      (mod.vfs_preload as (p: string, b: Uint8Array) => void)(
        prefix(path),
        bytes,
      );
    },

    invalidate(path: string) {
      (mod.vfs_invalidate as (p: string) => void)(prefix(path));
    },

    exists(path: string) {
      return (mod.vfs_exists as (p: string) => boolean)(prefix(path));
    },

    readdir(dirPath: string) {
      const arr = (mod.vfs_readdir as (p: string) => Iterable<string>)(
        prefix(dirPath || ""),
      );
      return Array.from(arr).map(String);
    },

    stat(path: string) {
      const s = mod.vfs_stat(prefix(path)) as {
        is_file?: boolean;
        is_dir?: boolean;
        size?: number;
        mtime?: number;
      } | null;
      if (!s) return null;
      return {
        isFile: () => !!s.is_file,
        isDirectory: () => !!s.is_dir,
        size: Number(s.size ?? 0),
        mtime: new Date(Number(s.mtime ?? 0)),
        mode: 0o644,
      };
    },

    mkdir(path: string) {
      (mod.vfs_mkdir as (p: string) => void)(prefix(path));
    },

    acquireLock(prefixPath: string) {
      return Number(
        (mod.vfs_acquire_lock as (p: string) => bigint)(prefixPath),
      );
    },

    releaseLock(id: number) {
      (mod.vfs_release_lock as (id: bigint) => void)(BigInt(id));
    },

    watch(path: string, recursive: boolean, callback: () => void) {
      return Number(
        (mod.vfs_watch as (p: string, r: boolean, cb: () => void) => bigint)(
          prefix(path),
          recursive,
          callback,
        ),
      );
    },

    unwatch(id: number) {
      (mod.vfs_unwatch as (id: bigint) => void)(BigInt(id));
    },

    removePrefix(prefixPath: string) {
      (mod.vfs_remove_prefix as (p: string) => void)(prefixPath);
    },

    listAllPaths() {
      return mod.vfs_list_all_paths
        ? Array.from((mod.vfs_list_all_paths as () => Iterable<string>)())
        : [];
    },

    rename(src: string, dest: string) {
      const sp = prefix(src);
      const dp = prefix(dest);
      const bytes = (mod.vfs_read as (p: string) => Uint8Array | null)(sp);
      if (bytes) {
        (mod.vfs_write as (p: string, b: Uint8Array) => void)(
          dp,
          new Uint8Array(bytes),
        );
        (mod.vfs_delete as (p: string) => void)(sp);
        return;
      }
      const st = mod.vfs_stat(sp) as { is_dir?: boolean } | null;
      if (st?.is_dir) {
        const all = mod.vfs_list_all_paths
          ? Array.from((mod.vfs_list_all_paths as () => Iterable<string>)())
          : [];
        const under = all.filter(
          (p: string) => p === sp || p.startsWith(sp + "/"),
        );
        (mod.vfs_mkdir as (p: string) => void)(dp);
        for (const p of under.sort(
          (a: string, b: string) => b.length - a.length,
        )) {
          if (p === sp) continue;
          const rest = p.slice(sp.length + 1);
          const newPath = dp + "/" + rest;
          const b = (mod.vfs_read as (p: string) => Uint8Array | null)(p);
          if (b) {
            (mod.vfs_write as (p: string, b: Uint8Array) => void)(
              newPath,
              new Uint8Array(b),
            );
            (mod.vfs_delete as (p: string) => void)(p);
          }
        }
        (mod.vfs_remove_prefix as (p: string) => void)(sp);
      } else {
        throw new Error("ENOENT: " + src);
      }
    },
  };
}

export async function initWasmVfs() {
  const url = new URL("/runtime/vfs_ram.js", location.origin).href;
  const mod = await import(/* @vite-ignore */ url);
  const wasmUrl = new URL("/runtime/vfs_ram_bg.wasm", location.origin);
  await mod.default({ module_or_path: wasmUrl });
  return createWasmVfsAdapter(mod);
}
