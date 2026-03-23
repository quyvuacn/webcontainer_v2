/**
 * CommonJS module loader — require() with async support.
 */

import { PathUtils } from "../vfs/core/path";
import { STUB_PACKAGES, getStubExports } from "./stub-packages";
import type { VirtualFS } from "../vfs/core/vfs";
import type { FileSource } from "../file-source/types";
import type { ModuleRecord } from "../types";
import { ModuleResolver } from "./resolver";
import {
  WC_BUILTINS,
  WC_ESBUILD,
  WC_CREATE_REQUIRE,
  WC_PATH,
  WC_ENTRY_PATH,
  WC_EXIT_HANDLER,
} from "../../js/lib/wc_globals";
import { ModuleCache } from "./cache";

/** Grace period after ESM bundle import() resolves — allows async process.exit() to propagate. */
const ASYNC_EXIT_GRACE_MS = 80;
import { detectFormat } from "../transform/detect";
import {
  esmToCjs,
  esmBundleForTLA,
  wrapEsbuildWithVfs,
} from "../transform/esm-to-cjs";
import { TypeScriptTransformer } from "../transform/typescript";
import { ProcessExitError, type ProcessPolyfill } from "../polyfills/process";

export interface CJSLoaderOptions {
  builtins: Map<string, unknown>;
}

export class CJSLoader {
  private transform = new TypeScriptTransformer();

  constructor(
    private vfs: VirtualFS,
    private resolver: ModuleResolver,
    private cache: ModuleCache,
    private builtins: Map<string, unknown>,
    private process: ProcessPolyfill,
    private syncCache?: Map<string, string | Uint8Array>,
    private fileSource?: FileSource,
  ) {}

  /**
   * Find the nearest tsconfig.json for the given file path.
   * Walks up from the file's directory, checking syncCache at each level.
   * Returns the raw JSON string, or undefined if not found.
   * Skips tsconfigs inside node_modules to avoid using package-level configs.
   */
  private findTsconfig(filePath: string): string | undefined {
    if (!this.syncCache) return undefined;
    // Don't apply project tsconfig to node_modules files
    if (filePath.includes("/node_modules/")) return undefined;
    let dir = PathUtils.dirname(filePath);
    for (let i = 0; i < 10 && dir && dir !== "/"; i++) {
      const candidate = PathUtils.join(dir, "tsconfig.json");
      const cached = this.syncCache.get(candidate);
      if (cached != null) {
        return typeof cached === "string"
          ? cached
          : new TextDecoder().decode(cached as Uint8Array);
      }
      dir = PathUtils.dirname(dir);
    }
    return undefined;
  }

  /** Create require function for a given caller path. */
  createRequire(callerPath: string) {
    const requireAsync = (id: string): unknown | Promise<unknown> => {
      // Return stub packages synchronously — some callers (e.g. chokidar) require sync, no await
      if (typeof id === "string") {
        if (STUB_PACKAGES.has(id)) return getStubExports(id);
        const stubs = [...STUB_PACKAGES].sort((a, b) => b.length - a.length); // longer first (rollup/parseAst before rollup)
        for (const stub of stubs) {
          if (
            id.startsWith(stub + "/") ||
            id.includes("/node_modules/" + stub + "/") ||
            id.endsWith("/node_modules/" + stub)
          ) {
            return getStubExports(stub);
          }
        }
      }
      return this.load(id, callerPath);
    };

    const requireSync = (_id: string): unknown => {
      throw new Error(
        "Synchronous require() not supported in browser. Use async loader or SyncBridge.",
      );
    };

    requireSync.resolve = (_id: string) => {
      throw new Error("require.resolve is async — use loader.resolve()");
    };

    // Synchronous require.resolve — needed for ESM bundles that call it without await
    // (e.g. vite's resolveDependencyVersion: path.resolve(require.resolve("rollup"), "../../package.json"))
    // If resolve is async (returns Promise), path.resolve coerces it to "[object Promise]" → wrong path.
    requireAsync.resolve = (id: string): string => {
      // Normalize callerPath: strip wc-file: prefix used by esbuild VFS plugin
      const base = callerPath.startsWith("wc-file:")
        ? callerPath.slice("wc-file:".length)
        : callerPath;
      const callerDir = PathUtils.dirname(base);

      // For relative/absolute ids, resolve directly
      if (id.startsWith("/") || id.startsWith("./") || id.startsWith("../")) {
        return PathUtils.join(callerDir, id);
      }

      // For bare package names, walk up looking for node_modules/<id>/package.json
      const pkgName =
        id.includes("/") && !id.startsWith("@")
          ? id.slice(0, id.indexOf("/"))
          : id.includes("/") && id.startsWith("@")
            ? id.slice(0, id.indexOf("/", id.indexOf("/") + 1))
            : id;
      const subPath = id.slice(pkgName.length); // e.g. "" or "/dist/something"

      let dir = callerDir;
      for (let i = 0; i < 15 && dir && dir !== "/"; i++) {
        const nmDir = PathUtils.join(dir, "node_modules", pkgName);
        const pkgJsonPath = PathUtils.join(nmDir, "package.json");

        let pkgText: string | undefined;
        const cached = this.syncCache?.get(pkgJsonPath);
        if (cached !== undefined) {
          pkgText =
            typeof cached === "string"
              ? cached
              : new TextDecoder().decode(cached);
        } else if (this.vfs.readFileSync) {
          try {
            const raw = this.vfs.readFileSync(pkgJsonPath, "utf8");
            pkgText =
              typeof raw === "string"
                ? raw
                : new TextDecoder().decode(raw as Uint8Array);
          } catch {
            /* not found at this level */
          }
        }

        if (pkgText !== undefined) {
          if (subPath) {
            // Subpath import e.g. require.resolve("pkg/dist/file")
            return PathUtils.join(nmDir, subPath);
          }
          try {
            const pkg = JSON.parse(pkgText) as Record<string, unknown>;
            // Resolve main entry: check exports["."] then main then index.js
            const exp = pkg.exports as Record<string, unknown> | undefined;
            const dotExport = exp?.["."];
            let main: string | undefined;
            if (typeof dotExport === "string") {
              main = dotExport;
            } else if (dotExport && typeof dotExport === "object") {
              const d = dotExport as Record<string, unknown>;
              main =
                (d.require as string) ||
                (d.node as string) ||
                (d.default as string);
            }
            if (!main) main = (pkg.main as string) || "index.js";
            if (main.startsWith("./")) main = main.slice(2);

            return PathUtils.join(nmDir, main);
          } catch {
            /* malformed package.json */
          }
        }

        dir = PathUtils.dirname(dir);
      }

      throw Object.assign(new Error(`Cannot find module '${id}'`), {
        code: "MODULE_NOT_FOUND",
      });
    };

    return requireAsync;
  }

  /** Resolve module id to absolute path. */
  async resolve(id: string, from: string): Promise<string> {
    return this.resolver.resolve(id, from);
  }

  /** Load module (async). Returns exports. */
  async load(id: string, from: string): Promise<unknown> {
    if (this.builtins.has(id)) {
      return this.builtins.get(id);
    }
    if (id.startsWith("node:") && this.builtins.has(id.slice(5))) {
      return this.builtins.get(id.slice(5));
    }
    if (STUB_PACKAGES.has(id)) {
      return getStubExports(id);
    }

    const resolved = await this.resolver.resolve(id, from);

    // In browser, esbuild (native) is Node-only; use esbuild-wasm so config bundling works.
    // Wrap with VFS plugin so config bundling can read files from virtual filesystem.
    // Check both id and resolved — require('esbuild') may resolve to node_modules path.
    if (
      id === "esbuild" ||
      resolved.includes("/node_modules/esbuild/") ||
      resolved.includes("/node_modules/esbuild-wasm/")
    ) {
      const mod = await import("esbuild-wasm");
      return wrapEsbuildWithVfs(
        mod as typeof import("esbuild-wasm"),
        this.vfs,
        this.resolver,
        this.syncCache,
        this.fileSource,
      );
    }

    // Stub packages when resolved to node_modules path (chokidar etc. may require by path)
    const stubs = [...STUB_PACKAGES].sort((a, b) => b.length - a.length);
    for (const stub of stubs) {
      if (
        resolved.includes("/node_modules/" + stub + "/") ||
        resolved.endsWith("/node_modules/" + stub)
      ) {
        return getStubExports(stub);
      }
    }

    if (this.cache.has(resolved)) {
      return this.cache.get(resolved)!.exports;
    }

    const reader = this.fileSource ?? this.vfs;
    const raw = await reader.readFile(resolved, "utf8");
    const content =
      typeof raw === "string" ? raw : new TextDecoder().decode(raw);

    if (resolved.endsWith(".json")) {
      const exports = JSON.parse(content);
      const record: ModuleRecord = {
        id: resolved,
        exports,
        loaded: true,
        children: [],
        filename: resolved,
        dirname: PathUtils.dirname(resolved),
      };
      this.cache.set(resolved, record);
      return exports;
    }

    const format = detectFormat(content, resolved);
    let code: string;
    let isEsmBundle = false;

    const tsconfigRaw = this.findTsconfig(resolved);

    if (format === "esm") {
      const fsMod = (this.builtins.get("node:fs") ??
        this.builtins.get("fs")) as Record<string, unknown> | undefined;
      if (fsMod) (globalThis as Record<string, unknown>).fs = fsMod;
      const pathMod = (this.builtins.get("node:path") ??
        this.builtins.get("path")) as
        | {
            join?: (...a: string[]) => string;
            resolve?: (...a: string[]) => string;
          }
        | undefined;
      if (pathMod) (globalThis as Record<string, unknown>).path = pathMod;
      (globalThis as Record<string, unknown>).process = this.process;
      try {
        code = await esmToCjs(content, resolved, tsconfigRaw);
      } catch (e) {
        if (/Top-level await.*"cjs"/.test(String(e))) {
          // ESM has top-level await — bundle as ESM and run via import()
          code = await esmBundleForTLA(
            resolved,
            this.vfs,
            this.resolver,
            this.syncCache,
            this.fileSource,
          );
          isEsmBundle = true;
        } else {
          throw e;
        }
      }
    } else {
      const result = await this.transform.transform(
        content,
        resolved,
        "cjs",
        tsconfigRaw,
      );
      code = result.code;
    }

    // ESM bundle with top-level await: execute via import(blobUrl)
    if (isEsmBundle) {
      const g = globalThis as Record<string, unknown>;
      const prevBuiltins = g[WC_BUILTINS];
      const prevEsbuild = g[WC_ESBUILD];
      const prevCreateRequire = g[WC_CREATE_REQUIRE];
      const prevGlobal = g.global;
      const prevProcess = g.process;
      const prevConsole = globalThis.console;
      const prevURL = globalThis.URL;
      const prevBuffer = g.Buffer;
      const prevEventEmitter = g.EventEmitter;
      const prevReadable = g.Readable;
      const prevWritable = g.Writable;
      const prevWcPath = g[WC_PATH];
      // When entry is a bin script (node_modules/.bin/<cmd> or node_modules/<pkg>/bin/<script>.js),
      // use the package's main field as __wcEntryPath so import.meta.url resolves correctly.
      // e.g. package constants: resolve(fileURLToPath(import.meta.url), '../../..') must give package root.
      let entryPath = resolved;
      const dotBinMatch = resolved.match(/^(.*\/node_modules)\/.bin\/([^/]+)$/);
      const pkgBinMatch =
        !dotBinMatch &&
        resolved.match(/^(.*\/node_modules\/([^/]+))\/bin\/[^/]+\.js$/);
      const pkgDir = dotBinMatch
        ? PathUtils.join(dotBinMatch[1]!, dotBinMatch[2]!)
        : pkgBinMatch
          ? pkgBinMatch[1]!
          : null;
      if (pkgDir) {
        try {
          const pkgRaw = await this.vfs.readFile(
            PathUtils.join(pkgDir, "package.json"),
            "utf8",
          );
          const pkgJson = JSON.parse(
            typeof pkgRaw === "string"
              ? pkgRaw
              : new TextDecoder().decode(pkgRaw as Uint8Array),
          ) as Record<string, unknown>;
          const main = (pkgJson.main as string | undefined) ?? "index.js";
          entryPath = PathUtils.join(pkgDir, main);
        } catch {
          entryPath = resolved;
        }
      }
      const entryFileUrl = "file://" + entryPath;
      g[WC_ENTRY_PATH] = entryPath;
      (globalThis as Record<string, unknown>).global = globalThis;
      (globalThis as Record<string, unknown>).process = this.process;
      // Ensure stdout/stderr have cursorTo — some CLI packages require it on a tty-like stream
      const p = this.process as {
        stdout?: { cursorTo?: unknown };
        stderr?: { cursorTo?: unknown };
      };
      const noopCursor = () => true;
      if (p.stdout && typeof p.stdout.cursorTo !== "function")
        p.stdout.cursorTo = noopCursor;
      if (p.stderr && typeof p.stderr.cursorTo !== "function")
        p.stderr.cursorTo = noopCursor;
      // Override URL: blob/wc-file/malformed file base breaks new URL(rel, base). Use file:// for VFS paths.
      globalThis.URL = class extends prevURL {
        constructor(input: string | URL, base?: string | URL) {
          let baseNorm = base;
          if (typeof base === "string") {
            if (base.startsWith("wc-file:"))
              baseNorm = "file://" + base.slice(8);
            else if (base.startsWith("file:/") && !base.startsWith("file://"))
              baseNorm = "file://" + base.slice(6);
            else if (
              base.startsWith("blob:") &&
              typeof input === "string" &&
              (input.startsWith("./") || input.startsWith("../"))
            ) {
              baseNorm = entryFileUrl;
            }
          }
          super(input as string, baseNorm as string | URL);
        }
      };
      // Override console so framework output goes to terminal
      globalThis.console = {
        log: (...a: unknown[]) =>
          this.process.stdout.write((a ?? []).map(String).join(" ") + "\r\n"),
        error: (...a: unknown[]) =>
          this.process.stderr.write((a ?? []).map(String).join(" ") + "\r\n"),
        warn: (...a: unknown[]) =>
          this.process.stderr.write((a ?? []).map(String).join(" ") + "\r\n"),
        info: (...a: unknown[]) =>
          this.process.stdout.write((a ?? []).map(String).join(" ") + "\r\n"),
        debug: (...a: unknown[]) =>
          this.process.stdout.write((a ?? []).map(String).join(" ") + "\r\n"),
        trace: prevConsole.trace.bind(prevConsole),
        dir: prevConsole.dir.bind(prevConsole),
        table: prevConsole.table.bind(prevConsole),
        time: prevConsole.time.bind(prevConsole),
        timeEnd: prevConsole.timeEnd.bind(prevConsole),
        timeLog: prevConsole.timeLog?.bind(prevConsole) ?? (() => {}),
        assert: (cond: boolean, ...a: unknown[]) => {
          if (!cond)
            this.process.stderr.write(
              "Assertion failed: " + (a ?? []).map(String).join(" ") + "\n",
            );
        },
        clear: prevConsole.clear?.bind(prevConsole) ?? (() => {}),
        count: prevConsole.count?.bind(prevConsole) ?? (() => {}),
        countReset: prevConsole.countReset?.bind(prevConsole) ?? (() => {}),
        group: prevConsole.group?.bind(prevConsole) ?? (() => {}),
        groupEnd: prevConsole.groupEnd?.bind(prevConsole) ?? (() => {}),
        groupCollapsed:
          prevConsole.groupCollapsed?.bind(prevConsole) ?? (() => {}),
        dirxml: prevConsole.dirxml?.bind(prevConsole) ?? (() => {}),
        timeStamp: prevConsole.timeStamp?.bind(prevConsole) ?? (() => {}),
      } as unknown as Console;
      g[WC_BUILTINS] = this.builtins;
      const fsMod = (this.builtins.get("node:fs") ??
        this.builtins.get("fs")) as Record<string, unknown> | undefined;
      if (fsMod) (globalThis as Record<string, unknown>).fs = fsMod;
      const pathModForEsbuild = (this.builtins.get("node:path") ??
        this.builtins.get("path")) as
        | {
            join?: (...a: string[]) => string;
            resolve?: (...a: string[]) => string;
          }
        | undefined;
      if (pathModForEsbuild)
        (globalThis as Record<string, unknown>).path = pathModForEsbuild;
      const bufMod = (this.builtins.get("node:buffer") ??
        this.builtins.get("buffer")) as { Buffer?: unknown } | undefined;
      if (bufMod?.Buffer)
        (globalThis as Record<string, unknown>).Buffer = bufMod.Buffer;
      const evMod = (this.builtins.get("node:events") ??
        this.builtins.get("events")) as
        | { EventEmitter?: new () => unknown }
        | undefined;
      if (evMod?.EventEmitter)
        (globalThis as Record<string, unknown>).EventEmitter =
          evMod.EventEmitter;
      const streamMod = (this.builtins.get("node:stream") ??
        this.builtins.get("stream")) as
        | ((new () => unknown) & { Readable?: unknown; Writable?: unknown })
        | undefined;
      if (streamMod?.Readable)
        (globalThis as Record<string, unknown>).Readable = streamMod.Readable;
      if (streamMod?.Writable)
        (globalThis as Record<string, unknown>).Writable = streamMod.Writable;
      const pathMod = (this.builtins.get("node:path") ??
        this.builtins.get("path")) as
        | { join?: (...args: string[]) => string }
        | undefined;
      if (pathMod?.join) g[WC_PATH] = pathMod;
      const urlMod = (this.builtins.get("node:url") ??
        this.builtins.get("url")) as
        | { fileURLToPath?: (u: string) => string }
        | undefined;
      const fileURLToPath =
        urlMod?.fileURLToPath ??
        ((u: string) =>
          u.replace(/^file:\/\/\//, "/").replace(/^file:\/\//, "/"));
      g[WC_CREATE_REQUIRE] = (pathOrUrl: string) => {
        const p =
          pathOrUrl.startsWith("file:") || pathOrUrl.startsWith("blob:")
            ? fileURLToPath(pathOrUrl)
            : pathOrUrl.startsWith("wc-file:")
              ? pathOrUrl.slice("wc-file:".length)
              : pathOrUrl;
        return this.createRequire(p);
      };
      try {
        const esbuildMod = await import("esbuild-wasm");
        if (typeof (esbuildMod as { build?: unknown }).build !== "function") {
          throw new Error(
            "esbuild.build is not a function — ensure esbuild-wasm is initialized",
          );
        }
        // Wrap esbuild so every build() call gets VFS plugin injected.
        // With worker: true, the Go WASM Worker can't access our VFS natively.
        g[WC_ESBUILD] = wrapEsbuildWithVfs(
          esbuildMod as typeof import("esbuild-wasm"),
          this.vfs,
          this.resolver,
          this.syncCache,
          this.fileSource,
        );
      } catch (e) {
        throw new Error(
          `Failed to load esbuild-wasm (required for config bundling): ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
      try {
        // Pre-load package.json files from entry up to root (tooling reads via readFileSync)
        if (this.syncCache) {
          let dir = PathUtils.dirname(resolved);
          let projectPkgJson: string | undefined;
          for (let i = 0; i < 10 && dir && dir !== "/"; i++) {
            // Skip subdirectories inside a node_modules package (e.g. vite/bin, vite/dist/node).
            // Only read package.json at the package root (node_modules/<pkg>) and above.
            const nmIdx = dir.lastIndexOf("/node_modules/");
            if (nmIdx >= 0) {
              const afterNm = dir.slice(nmIdx + "/node_modules/".length);
              const parts = afterNm.split("/");
              const pkgDepth = parts[0]?.startsWith("@") ? 2 : 1;
              if (parts.length > pkgDepth) {
                dir = PathUtils.dirname(dir);
                continue;
              }
            }
            const pkgJson = PathUtils.join(dir, "package.json");
            if (!this.syncCache.has(pkgJson)) {
              try {
                const reader = this.fileSource ?? this.vfs;
                const raw = await reader.readFile(pkgJson, "utf8");
                const content =
                  typeof raw === "string" ? raw : new TextDecoder().decode(raw);
                this.syncCache.set(pkgJson, content);
                if (!projectPkgJson && !dir.includes("/node_modules/"))
                  projectPkgJson = pkgJson;
              } catch {
                // File may not exist
              }
            }
            dir = PathUtils.dirname(dir);
          }
          // Aliases for paths that don't exist but tooling may request
          if (projectPkgJson) {
            const content = this.syncCache.get(projectPkgJson)!;
            const nodeModulesPkg = PathUtils.join(
              PathUtils.dirname(projectPkgJson),
              "node_modules",
              "package.json",
            );
            if (!this.syncCache.has(nodeModulesPkg))
              this.syncCache.set(nodeModulesPkg, content);
            if (!this.syncCache.has("/package.json"))
              this.syncCache.set("/package.json", content);
          }
          // Preload entry package so existsSync/readFileSync work for any file it may access at init.
          // Recursive walk with limit to avoid loading huge packages (e.g. dev server ~200 files in dist/).
          if (pkgDir) {
            const toLoad: string[] = [];
            const maxFiles = 500;
            const walk = async (dir: string): Promise<void> => {
              if (toLoad.length >= maxFiles) return;
              let names: string[];
              try {
                names = await this.vfs.readdir(dir);
              } catch {
                return;
              }
              for (const name of names) {
                if (toLoad.length >= maxFiles) return;
                if (name === "." || name === "..") continue;
                const p = PathUtils.join(dir, name);
                let isDir = false;
                try {
                  isDir = (await this.vfs.stat(p)).isDirectory();
                } catch {
                  /* treat as file */
                }
                if (isDir) await walk(p);
                else if (!this.syncCache!.has(p)) toLoad.push(p);
              }
            };
            try {
              await walk(pkgDir);
              const reader = this.fileSource ?? this.vfs;
              await Promise.all(
                toLoad.map(async (p) => {
                  try {
                    const raw = await reader.readFile(p, "utf8");
                    this.syncCache!.set(
                      p,
                      typeof raw === "string"
                        ? raw
                        : new TextDecoder().decode(raw as Uint8Array),
                    );
                  } catch {
                    this.syncCache!.set(p, "");
                  }
                }),
              );
            } catch {
              // Package dir may not exist
            }
          }
          // Preload project directory (excluding node_modules) so dev server can read via readFileSync.
          if (projectPkgJson) {
            const projectRoot = PathUtils.dirname(projectPkgJson);
            const toLoad: string[] = [];
            const walkProject = async (dir: string): Promise<void> => {
              const names = await this.vfs.readdir(dir);
              for (const name of names) {
                if (name === "node_modules" || name === "." || name === "..")
                  continue;
                const p = PathUtils.join(dir, name);
                const st = await this.vfs.stat(p);
                if (st.isDirectory()) await walkProject(p);
                else if (!this.syncCache!.has(p)) toLoad.push(p);
              }
            };
            try {
              await walkProject(projectRoot);
              await Promise.all(
                toLoad.map(async (p) => {
                  try {
                    const raw = await this.vfs.readFile(p, "utf8");
                    this.syncCache!.set(
                      p,
                      typeof raw === "string"
                        ? raw
                        : new TextDecoder().decode(raw as Uint8Array),
                    );
                  } catch {
                    this.syncCache!.set(p, "");
                  }
                }),
              );
            } catch {
              // Project dir may not exist
            }
          }
        }
        const blob = new Blob([code], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        // Capture ProcessExitError from async callbacks (e.g. Vite catch block) — import() resolves
        // before async code runs, so process.exit(1) becomes unhandled rejection without this.
        const exitPromise = new Promise<number>((resolve) => {
          const handler = (e: PromiseRejectionEvent) => {
            if (e.reason instanceof ProcessExitError) {
              e.preventDefault();
              resolve(e.reason.code);
            }
          };
          globalThis.addEventListener("unhandledrejection", handler);
          g[WC_EXIT_HANDLER] = handler;
        });
        const mod = await import(/* @vite-ignore */ url);
        URL.revokeObjectURL(url);
        const exitCode = await Promise.race([
          exitPromise,
          new Promise<null>((r) =>
            setTimeout(() => r(null), ASYNC_EXIT_GRACE_MS),
          ),
        ]);
        const exitHandler = g[WC_EXIT_HANDLER] as
          | ((e: PromiseRejectionEvent) => void)
          | undefined;
        if (exitHandler) {
          globalThis.removeEventListener("unhandledrejection", exitHandler);
          delete g[WC_EXIT_HANDLER];
        }
        if (exitCode !== null) throw new ProcessExitError(exitCode);
        const exports = mod.default !== undefined ? mod.default : mod;
        const record: ModuleRecord = {
          id: resolved,
          exports,
          loaded: true,
          children: [],
          filename: resolved,
          dirname: PathUtils.dirname(resolved),
        };
        this.cache.set(resolved, record);
        return exports;
      } finally {
        delete g[WC_ENTRY_PATH];
        // ESM bundles (dev server etc.) keep running async code after import() resolves.
        // Restoring global to undefined would break Vite (global.__vite_start_time) and other async code.
        if (prevGlobal !== undefined) g.global = prevGlobal;
        // Restoring globals to undefined would break all async continuations.
        // Keep them alive if there was no previous value (browser context = no real prev).
        if (prevBuiltins !== undefined) g[WC_BUILTINS] = prevBuiltins;
        if (prevEsbuild !== undefined) g[WC_ESBUILD] = prevEsbuild;
        if (prevCreateRequire !== undefined)
          g[WC_CREATE_REQUIRE] = prevCreateRequire;
        if (prevProcess !== undefined) g.process = prevProcess;
        // else: leave globalThis.process as the polyfill — async code (dev server) still needs it
        if (prevConsole !== undefined) globalThis.console = prevConsole;
        if (prevURL !== undefined) globalThis.URL = prevURL;
        if (prevBuffer !== undefined) g.Buffer = prevBuffer;
        else delete g.Buffer;
        if (prevEventEmitter !== undefined) g.EventEmitter = prevEventEmitter;
        else delete g.EventEmitter;
        if (prevReadable !== undefined) g.Readable = prevReadable;
        else delete g.Readable;
        if (prevWritable !== undefined) g.Writable = prevWritable;
        else delete g.Writable;
        if (prevWcPath !== undefined) g[WC_PATH] = prevWcPath;
        else delete g[WC_PATH];
      }
    }

    // Transform require() to await __req() for async loading
    // Preserve require.resolve as await __resolve(id)
    let asyncCode = code.replace(/require\.resolve\s*\(/g, "await __resolve(");
    asyncCode = asyncCode.replace(/\brequire\s*\(/g, "await __req(");

    // Override console to use process.stdout/stderr (defensive: a may be undefined)
    const consoleOverride =
      "const console = { log: (...a) => process.stdout.write((a??[]).map(String).join(' ') + '\\r\\n'), error: (...a) => process.stderr.write((a??[]).map(String).join(' ') + '\\r\\n'), warn: (...a) => process.stderr.write((a??[]).map(String).join(' ') + '\\r\\n'), info: (...a) => process.stdout.write((a??[]).map(String).join(' ') + '\\r\\n'), debug: (...a) => process.stdout.write((a??[]).map(String).join(' ') + '\\r\\n') }; ";
    asyncCode = consoleOverride + asyncCode;

    const module: ModuleRecord = {
      id: resolved,
      exports: {},
      loaded: false,
      children: [],
      filename: resolved,
      dirname: PathUtils.dirname(resolved),
    };
    this.cache.set(resolved, module);

    const __req = this.createRequire(resolved);
    const __resolve = (id: string) => this.resolver.resolve(id, resolved);
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;

    const fn = new AsyncFunction(
      "__req",
      "__resolve",
      "module",
      "exports",
      "__filename",
      "__dirname",
      "process",
      "globalThis",
      asyncCode,
    );

    await fn(
      __req,
      __resolve,
      module,
      module.exports,
      resolved,
      module.dirname,
      this.process,
      globalThis,
    );

    module.loaded = true;
    return module.exports;
  }

  /** Run entry point and return its exports. */
  async run(entryPath: string, cwd: string): Promise<unknown> {
    const resolved = PathUtils.isAbsolute(entryPath)
      ? PathUtils.normalize(entryPath)
      : PathUtils.join(cwd, entryPath);
    return this.load(resolved, PathUtils.dirname(resolved));
  }
}
