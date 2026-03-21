/**
 * Rewrite import/export specifiers in ESM source to absolute paths.
 * See docs/browser-module-resolver.md §8.
 *
 * Uses es-module-lexer (the same parser Vite uses internally) to locate
 * specifier byte offsets precisely — no regex, no false positives from
 * comments or string literals, correct on every valid ESM syntax.
 */

import { init, parse } from "es-module-lexer";
import type { VirtualFS } from "../vfs/core/vfs";
import {
  ModuleResolver,
  BROWSER_ALIAS,
  isBuiltinModule,
} from "../module-system/resolver";

// ---------------------------------------------------------------------------
// Builtin detection
// ---------------------------------------------------------------------------

const NODE_BUILTINS = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

function isKnownBuiltin(spec: string): boolean {
  const bare = spec.replace(/^node:/, "");
  return (
    isBuiltinModule(spec) ||
    isBuiltinModule("node:" + bare) ||
    NODE_BUILTINS.has(bare)
  );
}

// ---------------------------------------------------------------------------
// Protocol detection (no regex — compatible with all runtimes)
// ---------------------------------------------------------------------------

/**
 * Returns true for non-node: URI scheme specifiers (https:, data:, blob:, …).
 * Uses a manual char scan instead of a regex so it works in environments that
 * reject regex lookahead syntax at parse time.
 */
function isProtocolSpecifier(spec: string): boolean {
  if (spec.startsWith("node:")) return false;
  let i = 0;
  const first = spec.charCodeAt(0);
  // First char must be a-z / A-Z
  if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122)))
    return false;
  i = 1;
  while (i < spec.length) {
    const c = spec.charCodeAt(i);
    const ok =
      (c >= 65 && c <= 90) || // A-Z
      (c >= 97 && c <= 122) || // a-z
      (c >= 48 && c <= 57) || // 0-9
      c === 43 || // +
      c === 45 || // -
      c === 46; // .
    if (!ok) break;
    i++;
  }
  return i < spec.length && spec.charCodeAt(i) === 58; // ':'
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function toAbsolutePath(p: string, pathPrefix: string): string {
  const normalized = p.replace(/\\/g, "/").replace(/\/+/g, "/");
  const prefixNorm = pathPrefix.replace(/\/$/, "");
  if (normalized.startsWith(prefixNorm + "/") || normalized === prefixNorm) {
    return normalized;
  }
  return (prefixNorm + "/" + normalized.replace(/^\//, "")).replace(
    /\/+/g,
    "/",
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RewriteImportsOptions {
  /** Path prefix for browser fetch (e.g. /__wc__/). Default: /__wc__/ */
  pathPrefix?: string;
}

/**
 * Rewrite import/export specifiers to absolute paths for the browser.
 *
 * Specifier routing:
 *   https:, data:, blob:, …  → unchanged
 *   fs, node:fs, path, …     → pathPrefix/builtin/<name>
 *   /absolute                → pathPrefix/absolute
 *   ./rel, ../rel            → resolve() → pathPrefix/resolved
 *   bare-pkg                 → resolve() → pathPrefix/resolved
 */
export async function rewriteBareSpecifiersInModule(
  source: string,
  fromFile: string,
  vfs: VirtualFS,
  options: RewriteImportsOptions = {},
): Promise<string> {
  // es-module-lexer requires a one-time WASM init (no-op on subsequent calls).
  await init;

  const [imports] = (() => {
    try {
      return parse(source);
    } catch {
      // Lexer can throw on invalid/syntax-edge source — return unchanged.
      return [[], []] as const;
    }
  })();
  if (imports.length === 0) return source;

  const pathPrefix = options.pathPrefix ?? "/__wc__/";
  const resolver = new ModuleResolver(vfs, {
    conditions: ["import", "browser", "default"],
    alias: BROWSER_ALIAS,
  });

  // Resolve each unique specifier once, then apply all replacements in a single
  // descending-offset pass so earlier replacements never shift later offsets.
  const specToResolved = new Map<string, string>();

  for (const { n } of imports) {
    // n = statically-known specifier string; undefined for dynamic expressions
    // like import(variable) which we cannot rewrite anyway.
    if (n == null || specToResolved.has(n)) continue;
    if (isProtocolSpecifier(n)) continue;

    try {
      let resolved: string;

      if (n.startsWith("/")) {
        resolved = toAbsolutePath(n, pathPrefix);
      } else if (isKnownBuiltin(n)) {
        resolved = toAbsolutePath(
          "builtin/" + n.replace(/^node:/, ""),
          pathPrefix,
        );
      } else if (n.startsWith(".")) {
        resolved = toAbsolutePath(
          await resolver.resolve(n, fromFile),
          pathPrefix,
        );
      } else {
        resolved = toAbsolutePath(
          await resolver.resolve(n, fromFile),
          pathPrefix,
        );
      }

      specToResolved.set(n, resolved);
    } catch {
      // Unresolvable — leave as-is.
    }
  }

  if (specToResolved.size === 0) return source;

  // Apply replacements using byte offsets (s = start, e = end of specifier,
  // not including the surrounding quotes). Process highest offset first so
  // replacing one slice does not invalidate the offsets of earlier slices.
  const toReplace = imports
    .filter(({ n }) => n != null && specToResolved.has(n!))
    .sort((a, b) => b.s - a.s);

  let result = source;
  for (const { s, e, n } of toReplace) {
    const resolved = specToResolved.get(n!)!;
    result = result.slice(0, s) + resolved + result.slice(e);
  }

  return result;
}
