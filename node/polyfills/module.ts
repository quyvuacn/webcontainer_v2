/**
 * Stub for node:module — Node's module system. Minimal stub for browser.
 */

import { WC_CREATE_REQUIRE } from "../../js/lib/wc_globals";

// Canonical list of Node.js built-in module names (Node 20)
const BUILTIN_MODULES = [
  "assert", "assert/strict", "async_hooks", "buffer", "child_process",
  "cluster", "console", "constants", "crypto", "dgram", "diagnostics_channel",
  "dns", "dns/promises", "domain", "events", "fs", "fs/promises", "http",
  "http2", "https", "inspector", "inspector/promises", "module", "net", "os",
  "path", "path/posix", "path/win32", "perf_hooks", "process", "punycode",
  "querystring", "readline", "readline/promises", "repl", "stream",
  "stream/consumers", "stream/promises", "stream/web", "string_decoder",
  "sys", "timers", "timers/promises", "tls", "trace_events", "tty", "url",
  "util", "util/types", "v8", "vm", "wasi", "worker_threads", "zlib",
];

export function createModulePolyfill(): Record<string, unknown> {
  return {
    createRequire: (pathOrUrl: string) => {
      const fn = (globalThis as Record<string, unknown>)[WC_CREATE_REQUIRE] as
        | ((p: string) => unknown)
        | undefined;
      if (fn) return fn(pathOrUrl);
      throw new Error(
        "createRequire is not available — __wcCreateRequire not set (use CJSLoader for ESM bundle)",
      );
    },
    createRequireFromPath: (path: string) => {
      const fn = (globalThis as Record<string, unknown>)[WC_CREATE_REQUIRE] as
        | ((p: string) => unknown)
        | undefined;
      if (fn) return fn(path);
      throw new Error("createRequireFromPath is not available in browser");
    },
    Module: {
      _resolveFilename: (id: string) => id,
      _cache: {},
      _extensions: {},
      builtinModules: BUILTIN_MODULES,
      isBuiltin: (name: string) => {
        const bare = name.startsWith("node:") ? name.slice(5) : name;
        return BUILTIN_MODULES.includes(bare) || BUILTIN_MODULES.includes(name);
      },
    },
    runMain: () => {},
    wrap: (script: string) =>
      `(function (exports, require, module, __filename, __dirname) { ${script}\n});`,
    builtinModules: BUILTIN_MODULES,
    isBuiltin: (name: string): boolean => {
      const bare = name.startsWith("node:") ? name.slice(5) : name;
      return BUILTIN_MODULES.includes(bare) || BUILTIN_MODULES.includes(name);
    },
    register: () => {},
    syncBuiltinESMExports: () => {},
    findSourceMap: () => undefined,
    SourceMap: class SourceMap {
      constructor(_payload: unknown) {}
      findEntry() { return {}; }
    },
  };
}
