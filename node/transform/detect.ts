/**
 * Detect module format (CJS/ESM) and esbuild loader from file path and content.
 */

export type ModuleFormat = "cjs" | "esm" | "json" | "unknown";

export interface PackageJsonLike {
  type?: "module" | "commonjs";
  [key: string]: unknown;
}

// Matches: import x from 'y', import { x } from 'y', export default, export { x }, export const x, etc.
const ESM_IMPORT_RE =
  /\b(?:import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]|['"][^'"]+['"])\s*;?|export\s+(?:default\s+|(?:\{[^}]*\}|\*\s+from\s+['"][^'"]+['"])|(?:const|let|var|function|class|enum)\s+\w))/m;
const CJS_REQUIRE_RE = /\brequire\s*\(/;
const CJS_MODULE_EXPORTS_RE = /\bmodule\.exports\b/;

/**
 * Detect module format from code, file path, and optional package.json.
 */
export function detectFormat(
  code: string,
  filePath: string,
  pkg?: PackageJsonLike | null,
): ModuleFormat {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";

  // 1. Extension .mjs → ESM
  if (ext === "mjs") return "esm";

  // 2. Extension .cjs → CJS
  if (ext === "cjs") return "cjs";

  // 3. package.json "type": "module" → ESM
  if (pkg?.type === "module") return "esm";

  // 4. package.json "type": "commonjs" → CJS
  if (pkg?.type === "commonjs") return "cjs";

  // 5. JSON is always "json"
  if (ext === "json") return "json";

  // 6. Scan code: has import/export statement → ESM
  if (ESM_IMPORT_RE.test(code)) return "esm";

  // 7. Scan code: has require() or module.exports → CJS
  if (CJS_REQUIRE_RE.test(code) || CJS_MODULE_EXPORTS_RE.test(code))
    return "cjs";

  // 8. Default → CJS (Node.js default for .js)
  return "cjs";
}

/** esbuild Loader string for the given file path. */
export function detectLoader(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
      return "ts";
    case "tsx":
      return "tsx";
    case "jsx":
      return "jsx";
    case "json":
      return "json";
    case "css":
      return "css";
    case "js":
    case "mjs":
    case "cjs":
    default:
      // Use TypeScript loader for JS files — it's a superset of JS and supports
      // newer syntax (e.g. 'using' declarations / explicit resource management)
      // that the plain JS loader may reject in certain esbuild versions.
      return "ts";
  }
}
