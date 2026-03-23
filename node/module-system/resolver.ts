/**
 * Module path resolution — built-in, relative, node_modules, package exports.
 * Generic: no hardcoded package names. See docs/browser-module-resolver.md
 */

import { PathUtils } from "../vfs/core/path";
import { parsePackageJson } from "../pkg-json";
import type { VirtualFS } from "../vfs/core/vfs";
import { WC_ENTRY_PATH } from "../../js/lib/wc_globals";

export interface ModuleResolverOptions {
  /** Condition order for exports (e.g. ['import','browser','default'] for browser) */
  conditions?: string[];
  /** Alias map: bare specifier → resolved name. Configurable, no hardcoded packages. */
  alias?: Record<string, string>;
}

/** Default alias for browser runtime (native Node modules not available). */
export const BROWSER_ALIAS: Record<string, string> = {
  esbuild: "esbuild-wasm",
};

const BUILTINS = new Set([
  "fs",
  "fs/promises",
  "path",
  "process",
  "os",
  "events",
  "stream",
  "buffer",
  "crypto",
  "url",
  "util",
  "assert",
  "http",
  "https",
  "child_process",
  "tty",
  "worker_threads",
  "net",
  "querystring",
  "string_decoder",
  "zlib",
  "timers",
  "perf_hooks",
  "dns",
  "dgram",
  "cluster",
  "readline",
  "repl",
  "vm",
  "inspector",
  "module",
  "v8",
  "tls",
  "http2",
  "node:fs",
  "node:path",
  "node:process",
  "node:os",
  "node:events",
  "node:stream",
  "node:buffer",
  "node:crypto",
  "node:url",
  "node:util",
  "node:assert",
  "node:http",
  "node:https",
  "node:child_process",
  "node:worker_threads",
  "node:tty",
  "node:inspector",
  "node:module",
  "node:v8",
  "node:tls",
  "node:http2",
]);

/** Check if id is a Node builtin (for browser rewrite to /__wc__/builtin/<name>). */
export function isBuiltinModule(id: string): boolean {
  return BUILTINS.has(id) || BUILTINS.has(id.replace(/^node:/, ""));
}

const EXTENSIONS = [".js", ".mjs", ".cjs", ".ts", ".tsx", ".json"];
const INDEX_FILES = [
  "index.js",
  "index.mjs",
  "index.cjs",
  "index.ts",
  "index.jsx",
  "index.tsx",
  "index.json",
];

export class ModuleResolver {
  private conditions: string[];
  private alias: Record<string, string>;

  constructor(
    private vfs: VirtualFS,
    options: string[] | ModuleResolverOptions = {},
  ) {
    const opts = Array.isArray(options) ? { conditions: options } : options;
    this.conditions = opts.conditions ?? ["require", "node", "default"];
    this.alias = opts.alias ?? {};
  }

  /** Main resolve — auto-detect import type. */
  async resolve(id: string, from: string): Promise<string> {
    const fromPath =
      typeof from === "string" &&
      (from.includes("blob:") || from.startsWith("/blob:"))
        ? (((globalThis as Record<string, unknown>)[WC_ENTRY_PATH] as string) ??
          from)
        : from;
    if (this.isBuiltin(id)) {
      throw new Error(`Cannot resolve built-in module "${id}" to a file path`);
    }
    if (id.startsWith(".") || id.startsWith("/")) {
      return this.resolveRelative(id, fromPath);
    }
    return this.resolveNodeModules(id, fromPath);
  }

  private isBuiltin(id: string): boolean {
    return isBuiltinModule(id);
  }

  private async resolveRelative(id: string, from: string): Promise<string> {
    const dir = PathUtils.dirname(from);
    const joined = PathUtils.join(dir, id);
    return this.resolveFile(joined);
  }

  private async resolveNodeModules(id: string, from: string): Promise<string> {
    const [pkgName, subpath] = this.splitPackageSpecifier(id);
    const aliased = this.alias[pkgName] ?? pkgName;
    const toTry = aliased !== pkgName ? [aliased, pkgName] : [pkgName];
    const parts = PathUtils.split(PathUtils.dirname(from));
    for (let i = parts.length; i >= 0; i--) {
      const dir = "/" + parts.slice(0, i).join("/");
      for (const pkgId of toTry) {
        const nmPath = PathUtils.join(dir, "node_modules", pkgId);
        const resolved = subpath
          ? await this.tryResolvePackageSubpath(nmPath, subpath)
          : await this.tryResolveFile(nmPath);
        if (resolved) return resolved;
      }
    }
    throw new Error(`Cannot find module '${id}'`);
  }

  private splitPackageSpecifier(id: string): [string, string | null] {
    const slash = id.indexOf("/");
    if (slash < 0) return [id, null];
    const pkg = id.slice(0, slash);
    if (pkg.startsWith("@")) {
      const second = id.indexOf("/", slash + 1);
      if (second < 0) return [id, null];
      return [id.slice(0, second), id.slice(second + 1)];
    }
    return [pkg, id.slice(slash + 1)];
  }

  private async tryResolvePackageSubpath(
    pkgPath: string,
    subpath: string,
  ): Promise<string | null> {
    // Only check package.json at actual package roots — not inside subdirs like vite/bin/
    if (!this.isPackageRoot(pkgPath)) return null;
    const pkgJsonPath = PathUtils.join(pkgPath, "package.json");
    if (!(await this.vfs.exists(pkgJsonPath))) return null;
    const raw = await this.vfs.readFile(pkgJsonPath, "utf8");
    const pkg = parsePackageJson(
      typeof raw === "string"
        ? raw
        : new TextDecoder().decode(raw as Uint8Array),
    );
    if (!pkg) return null;
    const exports = pkg.exports as Record<string, unknown> | undefined;
    const exportKey = subpath.startsWith(".") ? subpath : "./" + subpath;
    if (exports && typeof exports === "object") {
      const entry = this.resolveExports(exports, exportKey);
      if (entry) {
        const candidates = Array.isArray(entry) ? entry : [entry];
        for (const rel of candidates) {
          const full = PathUtils.join(pkgPath, rel);
          const resolved = await this.tryResolveFile(full);
          if (resolved) return resolved;
        }
      }
    }
    return this.tryResolveFile(PathUtils.join(pkgPath, subpath));
  }

  private async tryResolveFile(path: string): Promise<string | null> {
    // Exact path or with extensions
    const exact = await this.tryExtensions(path);
    if (exact) return exact;

    // Package directory — check package.json FIRST (Node.js resolution order).
    // Only do this at actual package roots (directly under node_modules) to avoid
    // spurious CDN fetches for subdirectories like vite/bin/, vite/dist/node/, etc.
    if (this.isPackageRoot(path)) {
      const pkgPath = PathUtils.join(path, "package.json");
      if (await this.vfs.exists(pkgPath)) {
        return this.resolvePackage(path);
      }
    }

    // Fallback: bare directory with no package.json — try index files
    for (const idx of INDEX_FILES) {
      const full = PathUtils.join(path, idx);
      const exists = await this.vfs.exists(full);
      if (exists) return PathUtils.normalize(full);
    }

    return null;
  }

  /** True when path is directly under a node_modules dir (i.e. a package root). */
  private isPackageRoot(path: string): boolean {
    const norm = PathUtils.normalize(path);
    const parent = PathUtils.dirname(norm);
    const parentBase = PathUtils.basename(parent);
    if (parentBase === "node_modules") return true;
    // Scoped: node_modules/@scope/pkg
    const grandparent = PathUtils.dirname(parent);
    return (
      PathUtils.basename(grandparent) === "node_modules" &&
      parentBase.startsWith("@")
    );
  }

  private async resolveFile(path: string): Promise<string> {
    const result = await this.tryResolveFile(path);
    if (result) return result;
    throw new Error(`Cannot find module '${path}'`);
  }

  private async tryExtensions(path: string): Promise<string | null> {
    const norm = PathUtils.normalize(path);
    if (await this.vfs.exists(norm)) {
      const st = await this.vfs.stat(norm);
      if (st.isFile()) return norm;
    }

    const ext = PathUtils.extname(path);
    if (ext && EXTENSIONS.includes(ext)) return null;

    for (const ext of EXTENSIONS) {
      const withExt = norm + ext;
      if (await this.vfs.exists(withExt)) return withExt;
    }
    return null;
  }

  private async resolvePackage(pkgDir: string): Promise<string> {
    const pkgPath = PathUtils.join(pkgDir, "package.json");
    const raw = await this.vfs.readFile(pkgPath, "utf8");
    const pkg = parsePackageJson(
      typeof raw === "string"
        ? raw
        : new TextDecoder().decode(raw as Uint8Array),
    );
    if (!pkg) throw new Error(`Invalid package.json at ${pkgPath}`);

    const exports = pkg.exports as Record<string, unknown> | undefined;
    if (exports && typeof exports === "object") {
      const entry = this.resolveExports(exports, ".");
      if (entry) {
        const candidates = Array.isArray(entry) ? entry : [entry];
        for (const rel of candidates) {
          const full = PathUtils.join(pkgDir, rel);
          const resolved = await this.tryResolveFile(full);
          if (resolved) return resolved;
        }
      }
    }

    if (pkg.module) return PathUtils.join(pkgDir, pkg.module);
    if (pkg.main) return PathUtils.join(pkgDir, pkg.main);

    return this.resolveFile(PathUtils.join(pkgDir, "index"));
  }

  private resolveExports(
    exports: Record<string, unknown>,
    subpath: string,
  ): string | string[] | null {
    const key =
      subpath === "."
        ? "."
        : subpath.startsWith("./")
          ? subpath
          : "./" + subpath;

    // Exact match first
    let entry = exports[key] as unknown;
    if (entry == null) {
      entry = this.resolveExportsWildcard(exports, key);
    }
    if (entry == null) return null;

    if (typeof entry === "string") return entry;

    // Exports array: try each candidate
    if (Array.isArray(entry)) {
      for (const candidate of entry) {
        if (typeof candidate === "string") return candidate;
      }
      return null;
    }

    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const obj = entry as Record<string, unknown>;
      for (const cond of this.conditions) {
        const val = obj[cond];
        if (val != null) {
          const str = this.resolveExportsValue(val);
          if (str) return str;
        }
      }
      const def = this.resolveExportsValue(obj.default);
      if (def) return def;
    }
    return null;
  }

  /** Wildcard exports: "./utils/*" → "./src/utils/*.js" */
  private resolveExportsWildcard(
    exports: Record<string, unknown>,
    key: string,
  ): string | null {
    for (const [pattern, target] of Object.entries(exports)) {
      if (!pattern.includes("*") || typeof target !== "string") continue;
      const starIdx = pattern.indexOf("*");
      const prefix = pattern.slice(0, starIdx);
      const suffix = pattern.slice(starIdx + 1);
      if (!key.startsWith(prefix)) continue;
      if (suffix && !key.endsWith(suffix)) continue;
      const mid = key.slice(
        prefix.length,
        suffix ? key.length - suffix.length : undefined,
      );
      return target.replace("*", mid);
    }
    return null;
  }

  /** Handle nested exports: { import: { default: "./dist/index.js" } } */
  private resolveExportsValue(val: unknown): string | null {
    if (typeof val === "string") return val;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>;
      if (obj.default && typeof obj.default === "string") return obj.default;
      if (obj.types && typeof obj.types === "string") return obj.types;
    }
    return null;
  }

  /**
   * Resolve bare specifier for browser context (import/browser conditions).
   * Use when rewriting ESM imports before browser load.
   */
  async resolveForBrowser(id: string, from: string): Promise<string> {
    const browserResolver = new ModuleResolver(this.vfs, {
      conditions: ["import", "browser", "default"],
      alias: this.alias,
    });
    return browserResolver.resolve(id, from);
  }
}
