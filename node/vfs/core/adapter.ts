import { PathUtils } from "./path";

export interface VirtualFS {
  readFile(path: string, encoding?: string): Promise<string | Uint8Array>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  unlink(path: string): Promise<void>;
  rmdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<Stats>;
  readdir(path: string): Promise<string[]>;
  readFileSync?(path: string, encoding?: string): string | Uint8Array;
  existsSync?(path: string): boolean;
}

export interface Stats {
  ino: number;
  size: number;
  mode: number;
  atime: Date;
  mtime: Date;
  ctime: Date;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

function prefix(p: string): string {
  return p.startsWith("/") ? p.slice(1) : p;
}

export function createVirtualFSAdapter(ramVfs: {
  read(path: string): Uint8Array | null;
  write(path: string, content: Uint8Array): void;
  delete?(path: string): boolean | void;
  readdir?(path: string): string[] | Promise<string[]>;
  stat?(
    path: string,
  ):
    | Stats
    | { isFile: () => boolean; isDirectory: () => boolean; mtime?: Date }
    | null;
  exists(path: string): boolean;
  mkdir?(path: string): void | Promise<void>;
  files?: Map<string, unknown>;
  dirs?: Set<string> | { has: (p: string) => boolean };
}): VirtualFS {
  const ensurePath = (p: string) => PathUtils.normalize(p);

  async function readdir(path: string): Promise<string[]> {
    const p = prefix(ensurePath(path));
    if (ramVfs.readdir) {
      const out = ramVfs.readdir(p);
      return Array.isArray(out) ? out : (out as Promise<string[]>);
    }
    const names = new Set<string>();
    const files = (ramVfs as { files?: Map<string, string> }).files;
    if (files?.keys) {
      for (const key of files.keys()) {
        if (key === p) continue;
        if (key.startsWith(p + "/")) {
          const name = key.slice(p.length + 1).split("/")[0];
          if (name) names.add(name);
        }
      }
    }
    const dirs = ramVfs.dirs;
    if (dirs) {
      const has =
        typeof dirs.has === "function"
          ? dirs.has.bind(dirs)
          : (x: string) => (dirs as Set<string>).has(x);
      for (const d of dirs as Set<string>) {
        if (d === p) continue;
        if (d.startsWith(p + "/")) {
          const name = d.slice(p.length + 1).split("/")[0];
          if (name) names.add(name);
        }
      }
    }
    return [...names].sort();
  }

  function toStats(isFile: boolean, size: number, mtime: Date): Stats {
    const t = mtime instanceof Date ? mtime : new Date(mtime || 0);
    return {
      ino: 0,
      size,
      mode: isFile ? 0o644 : 0o755,
      atime: t,
      mtime: t,
      ctime: t,
      isFile: () => isFile,
      isDirectory: () => !isFile,
      isSymbolicLink: () => false,
    };
  }

  async function stat(path: string): Promise<Stats> {
    const p = prefix(ensurePath(path));
    const st = ramVfs.stat?.(p);
    if (st) {
      if ("isFile" in st && typeof st.isFile === "function") {
        return toStats(
          st.isFile(),
          (st as { size?: number }).size ?? 0,
          (st as { mtime?: Date }).mtime ?? new Date(0),
        );
      }
      return st as Stats;
    }
    const entry = (
      ramVfs.files as Map<string, { content?: Uint8Array; mtime?: number }>
    )?.get?.(p);
    if (entry) {
      return toStats(
        true,
        entry.content?.length ?? 0,
        new Date(entry.mtime ?? 0),
      );
    }
    const dirs = ramVfs.dirs as Set<string>;
    if (dirs?.has?.(p)) return toStats(false, 4096, new Date(0));
    throw Object.assign(new Error(`ENOENT: no such file, stat '${path}'`), {
      code: "ENOENT",
    });
  }

  return {
    async readFile(
      path: string,
      encoding?: string,
    ): Promise<string | Uint8Array> {
      const p = prefix(ensurePath(path));
      const bytes = ramVfs.read(p);
      if (!bytes)
        throw Object.assign(new Error(`ENOENT: no such file, open '${path}'`), {
          code: "ENOENT",
        });
      const arr = new Uint8Array(bytes);
      return encoding === "utf8" || encoding === "utf-8"
        ? new TextDecoder().decode(arr)
        : arr;
    },

    async writeFile(path: string, content: string | Uint8Array): Promise<void> {
      const p = prefix(ensurePath(path));
      const bytes =
        typeof content === "string"
          ? new TextEncoder().encode(content)
          : content;
      ramVfs.write(
        p,
        bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
      );
    },

    async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
      const p = prefix(ensurePath(path));
      const parts = p.split("/").filter(Boolean);
      if (ramVfs.mkdir) {
        const r = ramVfs.mkdir(p);
        if (r && typeof (r as Promise<unknown>).then === "function")
          await (r as Promise<unknown>);
        return;
      }
      const dirs = ramVfs.dirs as Set<string>;
      if (dirs) {
        for (let i = 1; i <= parts.length; i++) {
          dirs.add(parts.slice(0, i).join("/"));
        }
      }
    },

    async unlink(path: string): Promise<void> {
      const p = prefix(ensurePath(path));
      if (ramVfs.delete) {
        ramVfs.delete(p);
      } else {
        // Fallback: overwrite with empty to "delete" (best-effort)
        const files = ramVfs.files as Map<string, unknown> | undefined;
        files?.delete(p);
      }
    },

    async rmdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
      const p = prefix(ensurePath(path));
      if (opts?.recursive && ramVfs.readdir) {
        // Recursively delete via readdir walk
        const deleteDir = async (dir: string): Promise<void> => {
          let names: string[];
          try {
            names = await Promise.resolve(ramVfs.readdir!(dir));
          } catch {
            return;
          }
          for (const name of names) {
            if (name === "." || name === "..") continue;
            const child = dir + "/" + name;
            const st = ramVfs.stat?.(child);
            if (st?.isDirectory()) await deleteDir(child);
            else ramVfs.delete?.(child);
          }
          ramVfs.delete?.(dir);
          const dirs = ramVfs.dirs as Set<string> | undefined;
          dirs?.delete(dir);
        };
        await deleteDir(p);
      } else {
        ramVfs.delete?.(p);
        const dirs = ramVfs.dirs as Set<string> | undefined;
        dirs?.delete(p);
      }
    },

    async exists(path: string): Promise<boolean> {
      return ramVfs.exists(prefix(ensurePath(path)));
    },

    stat,
    readdir,

    readFileSync(path: string, encoding?: string): string | Uint8Array {
      const p = prefix(ensurePath(path));
      const bytes = ramVfs.read(p);
      if (!bytes)
        throw Object.assign(new Error(`ENOENT: no such file, open '${path}'`), {
          code: "ENOENT",
        });
      const arr = new Uint8Array(bytes);
      return encoding === "utf8" || encoding === "utf-8"
        ? new TextDecoder().decode(arr)
        : arr;
    },

    existsSync(path: string): boolean {
      return ramVfs.exists(prefix(ensurePath(path)));
    },
  };
}
