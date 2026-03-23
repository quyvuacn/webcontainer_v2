/**
 * ESM → CJS transform using esbuild-wasm.
 * Required because require() system only understands CJS.
 * Falls back to ESM bundle when source has top-level await (CJS doesn't support it).
 */

import * as esbuild from "esbuild-wasm";
import { PathUtils } from "../vfs/core/path";
import { detectLoader } from "./detect";
import { createVfsPlugin } from "./esbuild-vfs-plugin";
import type { VirtualFS } from "../vfs/core/vfs";
import type { ModuleResolver } from "../module-system/resolver";
import type { FileSource } from "../file-source/types";
import { WC_ESBUILD_WASM_MODULE, WC_ESBUILD_WASM_BYTES } from "../../js/lib/wc_globals";

let initialized = false;

export const ESBUILD_WASM_LOCAL = "/esbuild.wasm";
const _cdnBase =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: { VITE_CDN_BASE?: string } }).env?.VITE_CDN_BASE) ||
  "/pkg";
export const ESBUILD_WASM_CDN = `${_cdnBase}/esbuild-wasm@0.27.4/esbuild.wasm`;

/** Preload esbuild.wasm. Prefer local (faster, no network). Fallback to CDN.
 *  Stores bytes for Worker transfer. */
export async function preloadEsbuildWasm(): Promise<void> {
  if (typeof location === "undefined") return;
  const g = globalThis as Record<string, unknown>;
  if (g[WC_ESBUILD_WASM_MODULE]) return;
  for (const url of [ESBUILD_WASM_LOCAL, ESBUILD_WASM_CDN]) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const bytes = await res.arrayBuffer();
      g[WC_ESBUILD_WASM_BYTES] = bytes.slice(0);
      g[WC_ESBUILD_WASM_MODULE] = await WebAssembly.compile(bytes);
      return;
    } catch {
      continue;
    }
  }
  throw new Error("Failed to load esbuild.wasm (tried local and CDN)");
}

export async function ensureInit(): Promise<void> {
  if (initialized) return;
  try {
    const inWorker =
      typeof (globalThis as { WorkerGlobalScope?: unknown })
        .WorkerGlobalScope !== "undefined";
    const inBrowser =
      typeof (globalThis as { window?: unknown }).window !== "undefined";
    if (!inWorker && !inBrowser) {
      initialized = true;
      return;
    }
    const g = globalThis as Record<string, unknown>;
    const wasmModule = g[WC_ESBUILD_WASM_MODULE] as
      | WebAssembly.Module
      | undefined;
    await esbuild.initialize(
      wasmModule
        ? { wasmModule, worker: true }
        : { wasmURL: ESBUILD_WASM_LOCAL, worker: true },
    );
  } catch (e) {
    if (String(e).includes("more than once")) {
      // esbuild is a singleton
    } else {
      throw e;
    }
  }
  initialized = true;
}

export async function safeTransform(
  code: string,
  options: Parameters<typeof esbuild.transform>[1],
): Promise<esbuild.TransformResult> {
  await ensureInit();
  return esbuild.transform(code, options);
}

const _TLA_ERROR =
  /Top-level await is (currently not supported|not available) with the "cjs" (output )?format/;

/**
 * Convert ESM code to CJS format.
 * Throws when source has top-level await — caller should use esmBundleForTLA.
 */
export async function esmToCjs(
  code: string,
  filePath: string,
  tsconfigRaw?: string,
): Promise<string> {
  await ensureInit();

  const loader = detectLoader(filePath) as esbuild.Loader;
  // esbuild-wasm (Go WASM) expects Unix-style paths; backslashes can cause "Invalid path" / exit 1
  const sourcefile = filePath.replace(/\\/g, "/");
  try {
    const result = await esbuild.transform(code, {
      loader,
      format: "cjs",
      target: "esnext",
      sourcefile,
      ...(tsconfigRaw && { tsconfigRaw }),
    });
    return result.code;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const err = e instanceof Error ? e : new Error(String(e));
    const enriched = new Error(
      `esbuild transform failed for ${filePath}: ${msg}`,
      { cause: err },
    );
    if (
      "errors" in err &&
      Array.isArray((err as { errors?: unknown[] }).errors)
    ) {
      (enriched as { errors?: unknown[] }).errors = (
        err as { errors: unknown[] }
      ).errors;
    }
    if (
      "warnings" in err &&
      Array.isArray((err as { warnings?: unknown[] }).warnings)
    ) {
      (enriched as { warnings?: unknown[] }).warnings = (
        err as { warnings: unknown[] }
      ).warnings;
    }
    throw enriched;
  }
}

/**
 * Bundle ESM module (with top-level await) as ESM. Caller must execute via import(blobUrl)
 * after setting globalThis.__wcBuiltins = builtins.
 */
/**
 * Wrap esbuild module so every build() call automatically gets VFS plugin
 * injected as the LAST plugin (fallback). This ensures the Worker never
 * needs native fs access — critical for worker: true mode.
 */
/** Plugin that pre-injects config entry content from syncCache at build start.
 * Fixes empty output when esbuild runs in worker (syncCache not available there). */
function createEntryPreloadPlugin(
  syncCache: Map<string, string | Uint8Array> | undefined,
  entryPoints: string[] | undefined,
  absWorkingDir: string,
): import("esbuild-wasm").Plugin {
  const entryContent = new Map<string, string>();
  if (syncCache && Array.isArray(entryPoints)) {
    const cwd = absWorkingDir.replace(/\\/g, "/") || "/";
    for (const p of entryPoints) {
      const norm = p.replace(/\\/g, "/");
      const abs = norm.startsWith("/") ? norm : PathUtils.join(cwd, norm);
      const cached = syncCache.get(abs) ?? syncCache.get(norm);
      if (cached != null) {
        const s =
          typeof cached === "string"
            ? cached
            : new TextDecoder().decode(cached);
        if (s) {
          entryContent.set(abs, s);
          if (abs !== norm) entryContent.set(norm, s);
        }
      }
    }
  }
  return {
    name: "wc-entry-preload",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if ((args as { kind?: string }).kind !== "entry-point") return null;
        const path = args.path.replace(/\\/g, "/");
        const abs = path.startsWith("/")
          ? path
          : PathUtils.join(absWorkingDir.replace(/\\/g, "/") || "/", path);
        const key = entryContent.has(abs)
          ? abs
          : entryContent.has(path)
            ? path
            : null;
        if (!key) return null;
        return { path: key, namespace: "wc-entry-cached" };
      });
      build.onLoad({ filter: /.*/, namespace: "wc-entry-cached" }, (args) => {
        const content = entryContent.get(args.path);
        if (!content) return null;
        const ext = args.path.match(/\.(tsx?|json)$/)?.[1] ?? "js";
        const loader =
          ext === "ts" || ext === "tsx" ? "ts" : ext === "json" ? "json" : "ts";
        return { contents: content, loader };
      });
    },
  };
}

export function wrapEsbuildWithVfs(
  esbuildMod: typeof esbuild,
  vfs: VirtualFS,
  resolver: ModuleResolver,
  syncCache?: Map<string, string | Uint8Array>,
  fileSource?: FileSource,
): typeof esbuild {
  const wrappedBuild: typeof esbuild.build = (options) => {
    // Use browser conditions only for browser-platform builds (e.g. dep optimization).
    // For node-platform builds (e.g. config bundling), use Node.js conditions so that
    // packages like 'vite' (no browser export) resolve correctly.
    const useBrowserConditions = options.platform !== "node";
    const bridgePlugin = createVfsPlugin(vfs, resolver, syncCache, {
      fallbackMode: true,
      useBrowserConditions,
      ...(fileSource && { fileSource }),
    });

    const eps = (options as { entryPoints?: string[] | Record<string, string> })
      .entryPoints;
    const entryList = Array.isArray(eps)
      ? eps
      : typeof eps === "object" && eps
        ? Object.values(eps)
        : [];
    const cwd = (options.absWorkingDir || "/").replace(/\\/g, "/");
    const preloadPlugin = createEntryPreloadPlugin(syncCache, entryList, cwd);
    const plugins = [preloadPlugin, ...(options.plugins || []), bridgePlugin];
    const promise = esbuildMod.build({
      ...options,
      plugins,
      absWorkingDir: options.absWorkingDir || "/",
      // Pipeline fix: esbuild with sourcemap can produce output where outputFiles[0] is the
      // .map file, or inline sourcemap yields only the comment when JS part is empty.
      // Force no sourcemap so callers (e.g. config loaders) always get code, not map.
      sourcemap: false,
    });
    return promise.then((result) => {
      // Ensure JS before .map — callers often use outputFiles[0] for the main bundle.
      const of = result.outputFiles;
      if (of && of.length > 1) {
        const js = of.find((f) => f.path && !f.path.endsWith(".map"));
        const map = of.find((f) => f.path?.endsWith(".map"));
        if (js && map && of[0]?.path?.endsWith(".map")) {
          result.outputFiles = [js, map];
        }
      }
      // Empty bundle (e.g. stub resolution, pipeline edge case) → minimal valid ESM config.
      const first = result.outputFiles?.[0];
      const len = first?.contents?.byteLength ?? 0;
      if (first && len === 0) {
        const fallback = new TextEncoder().encode(
          "export default { root: '.', server: { port: 5173 }, optimizeDeps: { entries: [] } };\n",
        );
        result.outputFiles = [{ ...first, contents: fallback }];
      }
      return result;
    });
  };

  return new Proxy(esbuildMod, {
    get(target, prop) {
      if (prop === "build") return wrappedBuild;
      return (target as Record<string | symbol, unknown>)[prop];
    },
  }) as typeof esbuild;
}

export async function esmBundleForTLA(
  entryPath: string,
  vfs: VirtualFS,
  resolver: ModuleResolver,
  syncCache?: Map<string, string | Uint8Array>,
  fileSource?: FileSource,
): Promise<string> {
  await ensureInit();

  const plugin = createVfsPlugin(vfs, resolver, syncCache, {
    useBrowserConditions: true,
    ...(fileSource && { fileSource }),
  });
  // esbuild-wasm expects Unix-style paths
  const normalizedEntry = entryPath.replace(/\\/g, "/");
  const banner = `(function(){var b=globalThis.__wcBuiltins;if(b){var e=b.get("events")||b.get("node:events");var s=b.get("stream")||b.get("node:stream");var buf=b.get("buffer")||b.get("node:buffer");var p=b.get("path")||b.get("node:path");var proc=b.get("process")||b.get("node:process");var EE=e?.EventEmitter||s?.EventEmitter;if(EE)globalThis.EventEmitter=EE;if(s?.Readable)globalThis.Readable=s.Readable;if(s?.Writable)globalThis.Writable=s.Writable;if(buf?.Buffer)globalThis.Buffer=buf.Buffer;if(p?.join)globalThis.__wcPath=p;if(proc)globalThis.process=proc;}})();`;
  const result = await esbuild.build({
    entryPoints: [normalizedEntry],
    bundle: true,
    format: "esm",
    // Use esnext target so esbuild does not attempt to downcompile modern syntax
    // (e.g. 'using' declarations, import attributes) that its WASM version may
    // mis-parse when transforming for an older target. The bundled output always
    // runs in the same browser session which supports modern JS natively.
    target: "esnext",
    platform: "browser",
    write: false,
    plugins: [plugin],
    banner: { js: banner },
  });

  const out = result.outputFiles[0];
  if (!out) throw new Error("esbuild bundle produced no output");
  return new TextDecoder().decode(out.contents);
}
