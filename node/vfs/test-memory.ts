import { createVirtualFSAdapter } from "./core/adapter";

export function createMemoryVfs() {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();

  const ramVfs = {
    read(p: string) {
      return files.get(p) ?? null;
    },
    write(p: string, c: Uint8Array) {
      files.set(p, c instanceof Uint8Array ? c : new Uint8Array(c));
      const parts = p.split("/").filter(Boolean);
      for (let i = 1; i < parts.length; i++)
        dirs.add(parts.slice(0, i).join("/"));
    },
    exists(p: string) {
      return files.has(p) || dirs.has(p);
    },
    readdir(p: string) {
      const names = new Set<string>();
      for (const k of files.keys()) {
        if (k.startsWith(p + "/"))
          names.add(k.slice(p.length + 1).split("/")[0]);
      }
      for (const d of dirs) {
        if (d.startsWith(p + "/"))
          names.add(d.slice(p.length + 1).split("/")[0]);
      }
      return [...names];
    },
    stat(p: string) {
      if (files.has(p))
        return {
          isFile: () => true,
          isDirectory: () => false,
          size: files.get(p)!.length,
          mtime: new Date(),
        };
      if (dirs.has(p))
        return {
          isFile: () => false,
          isDirectory: () => true,
          size: 4096,
          mtime: new Date(),
        };
      return null;
    },
    mkdir(p: string) {
      dirs.add(p);
      const parts = p.split("/").filter(Boolean);
      for (let i = 1; i < parts.length; i++)
        dirs.add(parts.slice(0, i).join("/"));
    },
    delete(p: string) {
      files.delete(p);
      dirs.delete(p);
    },
    dirs,
    files,
  };
  return createVirtualFSAdapter(ramVfs);
}
