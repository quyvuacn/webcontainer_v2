export function createShellVfsAdapter(ramVfs: {
  read: (p: string) => Uint8Array | null;
  write: (p: string, c: Uint8Array | string) => void;
  readdir?: (p: string) => string[];
  exists?: (p: string) => boolean;
  stat?: (p: string) => {
    isFile: () => boolean;
    isDirectory: () => boolean;
    size?: number;
    mtime?: Date;
    mode?: number;
  } | null;
  mkdir?: (p: string) => void;
  delete?: (p: string) => boolean;
  removePrefix?: (p: string) => void;
  files?: Map<string, { content: Uint8Array; mtime?: number; mode?: number }>;
  dirs?: Set<string>;
  rename?: (s: string, d: string) => void;
}) {
  const prefix = (p: string) => (p.startsWith("/") ? p.slice(1) : p);

  return {
    async readFile(path: string, enc?: string) {
      const p = prefix(path);
      const bytes = ramVfs.read(p);
      if (!bytes) throw { code: "ENOENT", path: p };
      const content = new Uint8Array(bytes);
      return enc === "utf8" ? new TextDecoder().decode(content) : content;
    },

    async writeFile(path: string, content: string | Uint8Array) {
      ramVfs.write(
        prefix(path),
        typeof content === "string" ? content : content,
      );
    },

    async readdir(path: string) {
      const p = prefix(path);
      if (ramVfs.readdir) return ramVfs.readdir(p);
      const names = new Set<string>();
      for (const key of ramVfs.files?.keys?.() ?? []) {
        if (key === p) continue;
        if (key.startsWith(p + "/")) {
          const name = key.slice(p.length + 1).split("/")[0];
          if (name) names.add(name);
        }
      }
      for (const d of ramVfs.dirs ?? []) {
        if (d === p) continue;
        if (d.startsWith(p + "/")) {
          const name = d.slice(p.length + 1).split("/")[0];
          if (name) names.add(name);
        }
      }
      if (p && !ramVfs.exists?.(p)) throw { code: "ENOENT", path: p };
      return [...names].sort();
    },

    async stat(path: string) {
      const p = prefix(path);
      const st = ramVfs.stat?.(p);
      if (st) return st;
      const entry = ramVfs.files?.get?.(p);
      if (entry) {
        return {
          isFile: () => true,
          isDirectory: () => false,
          size: entry.content?.length ?? 0,
          mtime: new Date(entry.mtime || 0),
          mode: entry.mode ?? 0o644,
        };
      }
      if (ramVfs.dirs?.has?.(p)) {
        return {
          isFile: () => false,
          isDirectory: () => true,
          size: 4096,
          mtime: new Date(0),
          mode: 0o755,
        };
      }
      throw { code: "ENOENT", path: p };
    },

    async exists(path: string) {
      return ramVfs.exists?.(prefix(path)) ?? false;
    },

    async mkdir(path: string, _opts: { recursive?: boolean } = {}) {
      const p = prefix(path).split("/").filter(Boolean).join("/");
      if (ramVfs.mkdir) return ramVfs.mkdir(p);
      const parts = p.split("/");
      for (let i = 1; i <= parts.length; i++) {
        ramVfs.dirs!.add(parts.slice(0, i).join("/"));
      }
    },

    async unlink(path: string) {
      const p = prefix(path);
      if (ramVfs.delete) {
        if (!ramVfs.delete(p)) throw { code: "ENOENT", path: p };
      } else if (ramVfs.files?.has?.(p)) {
        ramVfs.files.delete(p);
      } else {
        throw { code: "ENOENT", path: p };
      }
    },

    async rmdir(path: string, opts: { recursive?: boolean } = {}) {
      const p = prefix(path);
      if (opts.recursive && ramVfs.removePrefix) {
        if (!ramVfs.exists?.(p)) throw { code: "ENOENT", path: p };
        ramVfs.removePrefix(p);
        return;
      }
      const dirs = ramVfs.dirs ?? new Set<string>();
      const files = ramVfs.files ?? new Map();
      if (!dirs.has?.(p)) throw { code: "ENOENT", path: p };
      if (opts.recursive) {
        const toDel = [...dirs].filter((d) => d === p || d.startsWith(p + "/"));
        for (const f of [...(files.keys?.() ?? [])]) {
          if (f === p || (f.startsWith(p + "/") && ramVfs.delete))
            ramVfs.delete(f);
          else if (files.delete) files.delete(f);
        }
        for (const d of toDel.sort((a, b) => b.length - a.length)) {
          dirs.delete(d);
        }
      } else {
        const hasChild = [...(files.keys?.() ?? []), ...dirs].some(
          (k) =>
            k.startsWith(p + "/") &&
            k.slice(p.length + 1).split("/").length === 1,
        );
        if (hasChild) throw { code: "ENOTEMPTY", path: p };
        dirs.delete(p);
      }
    },

    async copyFile(src: string, dest: string) {
      const s = prefix(src);
      const d = prefix(dest);
      const bytes = ramVfs.read(s);
      if (!bytes) throw { code: "ENOENT", path: s };
      ramVfs.write(d, bytes);
    },

    async rename(src: string, dest: string) {
      const s = prefix(src);
      const d = prefix(dest);
      if (ramVfs.rename) {
        try {
          ramVfs.rename(s, d);
        } catch {
          throw { code: "ENOENT", path: s };
        }
        return;
      }
      const entry = ramVfs.files?.get?.(s);
      if (entry) {
        ramVfs.write(d, entry.content);
        if (ramVfs.delete) ramVfs.delete(s);
        else ramVfs.files?.delete?.(s);
        return;
      }
      const dirs = ramVfs.dirs;
      if (dirs?.has?.(s)) {
        const files = ramVfs.files ?? new Map();
        dirs.add(d);
        for (const [k, v] of files) {
          if (k.startsWith(s + "/")) {
            ramVfs.write(
              d + k.slice(s.length),
              (v as { content: Uint8Array }).content ?? v,
            );
            if (ramVfs.delete) ramVfs.delete(k);
            else files.delete(k);
          }
        }
        for (const dir of dirs) {
          if (dir.startsWith(s + "/")) dirs.add(d + dir.slice(s.length));
        }
        dirs.delete(s);
        return;
      }
      throw { code: "ENOENT", path: s };
    },

    async chmod(path: string, mode: number) {
      const p = prefix(path);
      const entry = ramVfs.files?.get?.(p);
      if (!entry) throw { code: "ENOENT", path: p };
      (entry as { mode?: number }).mode = mode & 0o777;
    },
  };
}
