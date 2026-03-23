/**
 * Stub for node:module — Node's module system. Minimal stub for browser.
 */

import { WC_CREATE_REQUIRE } from "../../js/lib/wc_globals";

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
    createRequireFromPath: () => {
      throw new Error("createRequireFromPath is not available in browser");
    },
    Module: {},
    runMain: () => {},
    wrap: (script: string) =>
      `(function (exports, require, module, __filename, __dirname) { ${script}\n});`,
    builtinModules: [],
    isBuiltin: () => false,
    register: () => {},
    syncBuiltinESMExports: () => {},
    findSourceMap: () => undefined,
    SourceMap: {},
  };
}
