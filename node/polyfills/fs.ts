/**
 * Node fs module polyfill — hooks into VirtualFS.
 */

import { PathUtils } from "../vfs/core/path";
import type { VirtualFS } from "../vfs/core/vfs";
import type { Stats } from "../vfs/core/inode";
import type { FileSource } from "../file-source/types";
import { isNodeModulesPath } from "../file-source/parse-path";

type Encoding = "utf8" | "utf-8" | "buffer" | undefined;
type Callback = (err: Error | null, ...args: unknown[]) => void;

function toNodeStats(st: Stats): NodeStats {
  const atime = st.atime instanceof Date ? st.atime : new Date(st.atime);
  const mtime = st.mtime instanceof Date ? st.mtime : new Date(st.mtime);
  const ctime = st.ctime instanceof Date ? st.ctime : new Date(st.ctime);
  return {
    ...st,
    atime,
    mtime,
    ctime,
    birthtime: ctime,
    atimeMs: atime.getTime(),
    mtimeMs: mtime.getTime(),
    ctimeMs: ctime.getTime(),
    birthtimeMs: ctime.getTime(),
    dev: 0,
    nlink: 1,
    uid: 0,
    gid: 0,
    rdev: 0,
    blksize: 4096,
    blocks: 0,
    isFile: st.isFile,
    isDirectory: st.isDirectory,
    isSymbolicLink: st.isSymbolicLink,
  };
}

interface NodeStats extends Stats {
  atime: Date;
  mtime: Date;
  ctime: Date;
  birthtime: Date;
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  dev: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  blksize: number;
  blocks: number;
}

function cbOrOptions<T>(
  options: T | Callback | undefined,
  cb?: Callback,
): [T | undefined, Callback | undefined] {
  if (typeof options === "function") return [undefined, options as Callback];
  return [options, cb];
}

function resolvePath(cwd: string, p: string): string {
  if (PathUtils.isAbsolute(p)) return PathUtils.normalize(p);
  return PathUtils.join(cwd, p);
}

export interface FsPolyfillOptions {
  cwd?: string;
  getCwd?: () => string;
  /** Sync cache for readFileSync when backend has no sync API (e.g. IDBBackend). Populated by esbuild plugin + preload. */
  syncCache?: Map<string, string | Uint8Array>;
  /** FileSource for reads (e.g. HybridFileSource). When set, readFile uses it instead of vfs. */
  fileSource?: FileSource;
}

export function createFsPolyfill(
  vfs: VirtualFS,
  options: FsPolyfillOptions = {},
) {
  const getCwd = options.getCwd ?? (() => options.cwd ?? "/");
  const syncCache = options.syncCache;
  const fileSource = options.fileSource;

  const resolve = (p: string) => resolvePath(getCwd(), p);

  const readFileImpl = async (
    path: string,
    encoding?: "utf8",
  ): Promise<string | Uint8Array> => {
    if (fileSource) return fileSource.readFile(path, encoding);
    return vfs.readFile(path, encoding);
  };

  // File descriptor map for fs.open/close/read/write
  let fdCounter = 0;
  const fdMap = new Map<number, string>();

  const fs = {
    constants: {
      F_OK: 0,
      R_OK: 4,
      W_OK: 2,
      X_OK: 1,
      O_RDONLY: 0,
      O_WRONLY: 1,
      O_RDWR: 2,
      O_CREAT: 64,
      O_TRUNC: 512,
      O_APPEND: 1024,
      O_EXCL: 128,
      O_DIRECTORY: 0x10000,
    },

    // Sync write needed by Go WASM runtime (esbuild blob overrides this for stdout/stderr routing)
    writeSync: (fd: number, buf: Uint8Array | string): number => {
      return typeof buf === "string" ? buf.length : buf.byteLength;
    },

    // Go WASM stubs — required to exist on globalThis.fs or Go panics on property access.
    // Esbuild only uses fstat/readdir/stat/open/read/close/write; the rest are no-ops.
    chmod: (_path: string, _mode: number, cb: Callback) => {
      cb(null);
    },
    chown: (_path: string, _uid: number, _gid: number, cb: Callback) => {
      cb(null);
    },
    fchmod: (_fd: number, _mode: number, cb: Callback) => {
      cb(null);
    },
    fchown: (_fd: number, _uid: number, _gid: number, cb: Callback) => {
      cb(null);
    },
    fsync: (_fd: number, cb: Callback) => {
      cb(null);
    },
    ftruncate: (_fd: number, _len: number, cb: Callback) => {
      cb(null);
    },
    lchown: (_path: string, _uid: number, _gid: number, cb: Callback) => {
      cb(null);
    },
    link: (_path: string, _link: string, cb: Callback) => {
      cb(null);
    },
    // readlink is defined later with full encoding/callback support
    symlink: (_target: string, _path: string, cb: Callback) => {
      cb(null);
    },
    truncate: (_path: string, _len: number, cb: Callback) => {
      cb(null);
    },
    utimes: (_path: string, _atime: number, _mtime: number, cb: Callback) => {
      cb(null);
    },

    open: (
      path: string,
      flags: string | number,
      modeOrCb?: number | Callback,
      cb?: Callback,
    ) => {
      const [_, callback] = cbOrOptions(modeOrCb, cb);
      const done = callback ?? (() => {});
      const resolved = resolve(path);
      const isReadOnly = flags === "r" || flags === 0;
      (async () => {
        const exists = await vfs.exists(resolved);
        if (!exists && isReadOnly) {
          done(
            Object.assign(new Error(`ENOENT: no such file, open '${path}'`), {
              code: "ENOENT",
            }),
          );
          return;
        }
        if (!exists) await vfs.writeFile(resolved, new Uint8Array(0));
        fdCounter += 1;
        fdMap.set(fdCounter, resolved);
        done(null, fdCounter);
      })().catch(done);
    },

    close: (fd: number, cb?: Callback) => {
      const done = cb ?? (() => {});
      fdMap.delete(fd);
      done(null);
    },

    // Required by Go WASM (esbuild): fstat(1) for stdout at startup. fd 0,1,2 are stdio, never in fdMap.
    fstat: (fd: number, cb: Callback) => {
      const done = cb ?? (() => {});
      if (fd === 0 || fd === 1 || fd === 2) {
        const now = new Date();
        const st: NodeStats = {
          ino: 0,
          size: 0,
          mode: 0o020000,
          atime: now,
          mtime: now,
          ctime: now,
          birthtime: now,
          atimeMs: now.getTime(),
          mtimeMs: now.getTime(),
          ctimeMs: now.getTime(),
          birthtimeMs: now.getTime(),
          dev: 0,
          nlink: 1,
          uid: 0,
          gid: 0,
          rdev: 0,
          blksize: 4096,
          blocks: 0,
          isFile: () => false,
          isDirectory: () => false,
          isSymbolicLink: () => false,
        };
        return done(null, st);
      }
      const path = fdMap.get(fd);
      if (!path) {
        done(
          Object.assign(new Error("EBADF: bad file descriptor"), {
            code: "EBADF",
          }),
        );
        return;
      }
      vfs
        .stat(path)
        .then((st) => done(null, toNodeStats(st)))
        .catch(done);
    },

    read: (
      fd: number,
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number | null,
      cb: Callback,
    ) => {
      if (fd === 0) {
        cb(null, 0, buffer);
        return;
      }
      const path = fdMap.get(fd);
      if (!path) {
        cb(
          Object.assign(new Error("EBADF: bad file descriptor"), {
            code: "EBADF",
          }),
        );
        return;
      }
      readFileImpl(path)
        .then((data) => {
          const bytes =
            data instanceof Uint8Array
              ? data
              : new TextEncoder().encode(data as string);
          const pos = position ?? 0;
          const toRead = Math.min(
            length,
            bytes.length - pos,
            buffer.length - offset,
          );
          if (toRead > 0) buffer.set(bytes.subarray(pos, pos + toRead), offset);
          cb(null, toRead, buffer);
        })
        .catch((err) => cb(err));
    },

    write: (
      fd: number,
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number | null,
      cb: Callback,
    ) => {
      if (fd === 1 || fd === 2) {
        try {
          const chunk = buffer.subarray(offset, offset + length);
          const n = fs.writeSync(fd, chunk);
          cb(null, n, buffer);
        } catch (err) {
          cb(err as Error);
        }
        return;
      }
      const path = fdMap.get(fd);
      if (!path) {
        cb(
          Object.assign(new Error("EBADF: bad file descriptor"), {
            code: "EBADF",
          }),
        );
        return;
      }
      const chunk = buffer.subarray(offset, offset + length);
      readFileImpl(path)
        .then((existing) => {
          const bytes =
            existing instanceof Uint8Array
              ? existing
              : new TextEncoder().encode(existing as string);
          const pos = position ?? bytes.length;
          const newLen = Math.max(bytes.length, pos + chunk.length);
          const out = new Uint8Array(newLen);
          out.set(bytes);
          out.set(chunk, pos);
          return vfs.writeFile(path, out);
        })
        .catch(() => vfs.writeFile(path, chunk))
        .then(() => cb(null, length, buffer))
        .catch((err) => cb(err));
    },

    readFile: (
      path: string,
      options: Encoding | { encoding?: Encoding },
      cb?: Callback,
    ) => {
      const [opts, callback] = cbOrOptions(options, cb);
      const enc = (opts as { encoding?: Encoding })?.encoding ?? opts;
      const done = callback ?? (() => {});
      const r = resolve(path);
      readFileImpl(r, enc === "utf8" || enc === "utf-8" ? "utf8" : undefined)
        .then((data) => done(null, data))
        .catch((err) => done(err));
    },

    writeFile: (
      path: string,
      data: string | Uint8Array,
      options: Encoding | { encoding?: Encoding },
      cb?: Callback,
    ) => {
      const [_, callback] = cbOrOptions(options, cb);
      const done = callback ?? (() => {});
      vfs
        .writeFile(resolve(path), data)
        .then(() => done(null))
        .catch(done);
    },

    appendFile: (
      path: string,
      data: string | Uint8Array,
      options: Encoding | { encoding?: Encoding },
      cb?: Callback,
    ) => {
      const [_, callback] = cbOrOptions(options, cb);
      const done = callback ?? (() => {});
      vfs
        .appendFile(resolve(path), data)
        .then(() => done(null))
        .catch(done);
    },

    unlink: (path: string, cb?: Callback) => {
      const done = cb ?? (() => {});
      vfs
        .unlink(resolve(path))
        .then(() => done(null))
        .catch(done);
    },

    mkdir: (
      path: string,
      options: { recursive?: boolean } | Callback,
      cb?: Callback,
    ) => {
      const [opts, callback] = cbOrOptions(options, cb);
      const done = callback ?? (() => {});
      const recursive = (opts as { recursive?: boolean })?.recursive ?? false;
      vfs
        .mkdir(resolve(path), { recursive })
        .then(() => done(null))
        .catch(done);
    },

    rmdir: (
      path: string,
      options: { recursive?: boolean } | Callback,
      cb?: Callback,
    ) => {
      const [opts, callback] = cbOrOptions(options, cb);
      const done = callback ?? (() => {});
      const recursive = (opts as { recursive?: boolean })?.recursive ?? false;
      vfs
        .rmdir(resolve(path), { recursive })
        .then(() => done(null))
        .catch(done);
    },

    rm: (
      path: string,
      options: { recursive?: boolean; force?: boolean } | Callback,
      cb?: Callback,
    ) => {
      const [opts, callback] = cbOrOptions(options, cb);
      const done = callback ?? (() => {});
      const recursive = (opts as { recursive?: boolean })?.recursive ?? false;
      vfs
        .stat(resolve(path))
        .then(async (st) => {
          if (st.isDirectory()) await vfs.rmdir(resolve(path), { recursive });
          else await vfs.unlink(resolve(path));
          done(null);
        })
        .catch(done);
    },

    readdir: (
      path: string,
      options: { encoding?: string; withFileTypes?: boolean } | Callback,
      cb?: Callback,
    ) => {
      const [_opts, callback] = cbOrOptions(options, cb);
      const done = callback ?? (() => {});
      vfs
        .readdir(resolve(path))
        .then((names) => done(null, names))
        .catch(done);
    },

    stat: (
      path: string,
      options: { bigint?: boolean } | Callback,
      cb?: Callback,
    ) => {
      const [_, callback] = cbOrOptions(options, cb);
      const done = callback ?? (() => {});
      vfs
        .stat(resolve(path))
        .then((st) => done(null, toNodeStats(st)))
        .catch(done);
    },

    lstat: (
      path: string,
      options: { bigint?: boolean } | Callback,
      cb?: Callback,
    ) => {
      return fs.stat(path, options, cb);
    },

    exists: (path: string, cb: (exists: boolean) => void) => {
      vfs.exists(resolve(path)).then(cb);
    },

    rename: (oldPath: string, newPath: string, cb?: Callback) => {
      const done = cb ?? (() => {});
      vfs
        .rename(resolve(oldPath), resolve(newPath))
        .then(() => done(null))
        .catch(done);
    },

    copyFile: (
      src: string,
      dest: string,
      flags: number | Callback,
      cb?: Callback,
    ) => {
      const done = (typeof flags === "function" ? flags : cb) ?? (() => {});
      vfs
        .copyFile(resolve(src), resolve(dest))
        .then(() => done(null))
        .catch(done);
    },

    watch: (
      path: string,
      options:
        | { recursive?: boolean }
        | ((event: string, filename: string) => void),
      listener?: (event: string, filename: string) => void,
    ) => {
      const opts = typeof options === "function" ? {} : options;
      const cb = typeof options === "function" ? options : listener!;
      const handle = vfs.watch(
        resolve(path),
        opts?.recursive ?? false,
        (ev) => {
          cb(ev.type, ev.path);
        },
      );
      return {
        close: () => vfs.unwatch(handle),
      };
    },

    // Sync versions — use syncCache when backend has no sync API (IDBBackend), else use vfs.readFileSync
    readFileSync: (
      path: string | URL,
      options?: Encoding | { encoding?: Encoding },
    ): string | Uint8Array => {
      const p =
        typeof path === "object" && path instanceof URL
          ? path.pathname
          : String(path);
      const resolved = resolve(p);
      const enc = (typeof options === "object" && options?.encoding) || options;
      const wantUtf8 = enc === undefined || enc === "utf8" || enc === "utf-8";

      if (syncCache) {
        const cached = syncCache.get(resolved);
        if (cached !== undefined) {
          if (wantUtf8)
            return typeof cached === "string"
              ? cached
              : new TextDecoder().decode(cached);
          return typeof cached === "string"
            ? new TextEncoder().encode(cached)
            : cached;
        }
      }

      // If VFS has a sync implementation (SAB-backed), use it directly
      if (vfs.readFileSync) {
        return vfs.readFileSync(resolved, wantUtf8 ? "utf8" : undefined);
      }

      if (fileSource && isNodeModulesPath(resolved)) {
        const isPackageJson =
          resolved.endsWith("/package.json") ||
          resolved.endsWith("package.json");
        if (isPackageJson) {
          try {
            return vfs.readFileSync(resolved, wantUtf8 ? "utf8" : undefined);
          } catch {
            // Backend may not support sync (e.g. IDB) — fall through to error
          }
        }
        throw new Error(
          `readFileSync not supported for node_modules in server-backed mode: ${resolved}`,
        );
      }

      if (syncCache) {
        throw new Error(
          `readFileSync: ${resolved} not in sync cache (IDB backend — preload required)`,
        );
      }
      return vfs.readFileSync(resolved, wantUtf8 ? "utf8" : undefined);
    },
    writeFileSync: (
      path: string,
      data: string | Uint8Array | ArrayBuffer | DataView,
      options?: { encoding?: string },
    ) => {
      const resolved = PathUtils.normalize(
        resolve(typeof path === "string" ? path : String(path)),
      );
      const len =
        typeof data === "string"
          ? data.length
          : data instanceof Uint8Array
            ? data.byteLength
            : data instanceof ArrayBuffer
              ? data.byteLength
              : ArrayBuffer.isView(data)
                ? data.byteLength
                : 0;
      const enc =
        (options && typeof options === "object" && options.encoding) ?? "utf8";
      const bytes =
        typeof data === "string"
          ? enc === "utf8" || enc === "utf-8"
            ? new TextEncoder().encode(data)
            : new TextEncoder().encode(data)
          : data instanceof Uint8Array
            ? data
            : data instanceof ArrayBuffer
              ? new Uint8Array(data)
              : ArrayBuffer.isView(data)
                ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
                : new Uint8Array(0);
      if (syncCache) {
        syncCache.set(resolved, bytes);
        vfs.writeFile(resolved, bytes).catch(() => {});
      } else {
        throw new Error(
          "writeFileSync not supported in browser (no syncCache)",
        );
      }
    },
    existsSync: (path: string): boolean => {
      const resolved = resolve(typeof path === "string" ? path : String(path));
      if (syncCache) {
        if (syncCache.has(resolved)) return true;
        const prefix = resolved.endsWith("/") ? resolved : resolved + "/";
        for (const k of syncCache.keys()) {
          if (k === resolved || k.startsWith(prefix)) return true;
        }
        // syncCache only has project files — fall through to VFS for node_modules etc.
        if (vfs.existsSync) return vfs.existsSync(resolved);
        return false;
      }
      return vfs.existsSync(resolved);
    },
    mkdirSync: (
      path: string,
      options?: { recursive?: boolean; mode?: number },
    ) => {
      const resolved = PathUtils.normalize(
        resolve(typeof path === "string" ? path : String(path)),
      );
      const recursive =
        (options && typeof options === "object" && options.recursive) ?? false;
      vfs.mkdir(resolved, { recursive }).catch(() => {});
    },
    readdirSync: (
      path: string,
      options?: { encoding?: string; withFileTypes?: boolean },
    ): string[] => {
      const resolved = PathUtils.normalize(
        resolve(typeof path === "string" ? path : String(path)),
      );
      if (syncCache) {
        const prefix =
          resolved === "/"
            ? "/"
            : resolved.endsWith("/")
              ? resolved
              : resolved + "/";
        const children = new Set<string>();
        for (const k of syncCache.keys()) {
          if (k === resolved) continue;
          if (k.startsWith(prefix)) {
            const rest = k.slice(prefix.length);
            const name = rest.includes("/") ? rest.split("/")[0]! : rest;
            if (name && name !== "." && name !== "..") children.add(name);
          }
        }
        return Array.from(children);
      }
      throw new Error("readdirSync not supported in browser");
    },
    statSync: (path: string): NodeStats => {
      const resolved = PathUtils.normalize(
        resolve(typeof path === "string" ? path : String(path)),
      );
      if (syncCache) {
        const now = new Date();
        const dirStats: NodeStats = {
          ino: 0,
          size: 0,
          mode: 0o755,
          atime: now,
          mtime: now,
          ctime: now,
          birthtime: now,
          atimeMs: now.getTime(),
          mtimeMs: now.getTime(),
          ctimeMs: now.getTime(),
          birthtimeMs: now.getTime(),
          dev: 0,
          nlink: 1,
          uid: 0,
          gid: 0,
          rdev: 0,
          blksize: 4096,
          blocks: 0,
          isFile: () => false,
          isDirectory: () => true,
          isSymbolicLink: () => false,
        };
        if (syncCache.has(resolved)) {
          const cached = syncCache.get(resolved)!;
          return {
            ...dirStats,
            mode: 0o644,
            isFile: () => true,
            isDirectory: () => false,
            size:
              typeof cached === "string"
                ? new TextEncoder().encode(cached).length
                : cached.length,
          };
        }
        const prefix = resolved.endsWith("/") ? resolved : resolved + "/";
        for (const k of syncCache.keys()) {
          if (k.startsWith(prefix)) return dirStats;
        }
      }
      if (vfs.readFileSync) {
        const now = new Date();
        try {
          const content = vfs.readFileSync(resolved);
          const size =
            typeof content === "string"
              ? new TextEncoder().encode(content).length
              : (content as Uint8Array).length;
          return {
            ino: 0,
            size,
            mode: 0o644,
            atime: now,
            mtime: now,
            ctime: now,
            birthtime: now,
            atimeMs: now.getTime(),
            mtimeMs: now.getTime(),
            ctimeMs: now.getTime(),
            birthtimeMs: now.getTime(),
            dev: 0,
            nlink: 1,
            uid: 0,
            gid: 0,
            rdev: 0,
            blksize: 4096,
            blocks: Math.ceil(size / 512),
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
          };
        } catch {
          if (vfs.existsSync?.(resolved)) {
            return {
              ino: 0,
              size: 0,
              mode: 0o755,
              atime: now,
              mtime: now,
              ctime: now,
              birthtime: now,
              atimeMs: now.getTime(),
              mtimeMs: now.getTime(),
              ctimeMs: now.getTime(),
              birthtimeMs: now.getTime(),
              dev: 0,
              nlink: 2,
              uid: 0,
              gid: 0,
              rdev: 0,
              blksize: 4096,
              blocks: 0,
              isFile: () => false,
              isDirectory: () => true,
              isSymbolicLink: () => false,
            };
          }
          throw Object.assign(
            new Error(`ENOENT: no such file or directory, stat '${path}'`),
            { code: "ENOENT" },
          );
        }
      }
      throw new Error("statSync not supported in browser");
    },
    lstatSync: () => {
      throw new Error("lstatSync not supported in browser");
    },
    readlink: (path: string, options: Encoding | Callback, cb?: Callback) => {
      const [_, callback] = cbOrOptions(options, cb);
      const done = callback ?? (() => {});
      Promise.resolve(PathUtils.normalize(resolve(path)))
        .then((p) => done(null, p))
        .catch(done);
    },
    readlinkSync: (path: string): string => {
      return PathUtils.normalize(resolve(path));
    },
    realpath: (
      path: string,
      options: Encoding | { encoding?: Encoding } | Callback,
      cb?: Callback,
    ) => {
      const [_, callback] = cbOrOptions(options, cb);
      const done = callback ?? (() => {});
      Promise.resolve(PathUtils.normalize(resolve(path)))
        .then((p) => done(null, p))
        .catch(done);
    },
    realpathSync: (path: string): string => {
      return PathUtils.normalize(resolve(path));
    },
    unlinkSync: () => {
      throw new Error("unlinkSync not supported in browser");
    },
    rmdirSync: () => {
      throw new Error("rmdirSync not supported in browser");
    },

    promises: {
      readFile: async (
        path: string,
        opts?: Encoding | { encoding?: Encoding },
      ) => {
        const r = resolve(path);
        const data = await readFileImpl(
          r,
          (opts as { encoding?: Encoding })?.encoding === "utf8" ||
            opts === "utf8"
            ? "utf8"
            : undefined,
        );
        const len = typeof data === "string" ? data.length : data.byteLength;
        return data;
      },
      writeFile: async (
        path: string,
        data: string | Uint8Array,
        _opts?: { encoding?: Encoding },
      ) => {
        const r = resolve(path);
        let len = typeof data === "string" ? data.length : data.byteLength;
        // Config bundler (esbuild/Rolldown) sometimes produces 0 bytes → write fallback so Vite can load.
        if (r.includes("timestamp") && r.endsWith(".mjs")) {
          if (len === 0) {
            data =
              "export default { root: '.', server: { port: 5173 }, clearScreen: false, optimizeDeps: { entries: [] } };\n";
            len = data.length;
          }
        }
        await vfs.writeFile(r, data);
        syncCache?.set(r, data);
        // __wc__ fetch: SW asks main thread → reads from VFS (single source of truth)
      },
      appendFile: (
        path: string,
        data: string | Uint8Array,
        _opts?: { encoding?: Encoding },
      ) => vfs.appendFile(resolve(path), data),
      mkdir: async (path: string, opts?: { recursive?: boolean }) => {
        const r = resolve(path);
        await vfs.mkdir(r, opts ?? {});
      },
      readdir: (
        path: string,
        _opts?: { encoding?: string; withFileTypes?: boolean },
      ) => vfs.readdir(resolve(path)),
      stat: (path: string) => vfs.stat(resolve(path)).then(toNodeStats),
      lstat: (path: string) => vfs.stat(resolve(path)).then(toNodeStats),
      readlink: (path: string) =>
        Promise.resolve(PathUtils.normalize(resolve(path))),
      realpath: (path: string) =>
        Promise.resolve(PathUtils.normalize(resolve(path))),
      unlink: (path: string) => vfs.unlink(resolve(path)),
      rm: async (
        path: string,
        opts?: { recursive?: boolean; force?: boolean },
      ) => {
        try {
          const st = await vfs.stat(resolve(path));
          if (st.isDirectory()) await vfs.rmdir(resolve(path), opts ?? {});
          else await vfs.unlink(resolve(path));
        } catch (e: unknown) {
          // With force:true, ENOENT is silently ignored (matches Node.js behavior)
          if (opts?.force && (e as { code?: string }).code === "ENOENT") return;
          throw e;
        }
      },
      rename: (oldPath: string, newPath: string) =>
        vfs.rename(resolve(oldPath), resolve(newPath)),
      copyFile: (src: string, dest: string) =>
        vfs.copyFile(resolve(src), resolve(dest)),
      watch: (path: string, opts?: { recursive?: boolean }) => {
        const handle = vfs.watch(
          resolve(path),
          opts?.recursive ?? false,
          () => {},
        );
        return {
          close: () => vfs.unwatch(handle),
        };
      },
    },
  };

  return fs;
}
