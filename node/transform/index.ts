/**
 * Transform layer — TS/ESM → JS for Node Executor.
 */

export { detectFormat, detectLoader } from "./detect";
export type { ModuleFormat, PackageJsonLike } from "./detect";
export { TypeScriptTransformer } from "./typescript";
export { esmToCjs, ensureInit, preloadEsbuildWasm } from "./esm-to-cjs";
export { rewriteBareSpecifiersInModule } from "./bare-specifier-rewrite";
