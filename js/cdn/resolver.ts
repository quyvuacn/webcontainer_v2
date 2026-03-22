import { CDN_BASE } from "./config";

// ─────────────────────────────────────────────────────────
// constants

const DEFAULT_CONDITIONS = ["browser", "import", "module", "default"];

// ─────────────────────────────────────────────────────────
// utils

function normalizeSubpath(subpath: string) {
  if (!subpath || subpath === ".") return ".";
  return subpath.startsWith("./") ? subpath : "./" + subpath;
}

function stripDotSlash(p: string) {
  return p.startsWith("./") ? p.slice(2) : p;
}

// ─────────────────────────────────────────────────────────
// exports resolver (fixed)

export function resolveExports(
  exports: unknown,
  subpath: string,
  conditions = DEFAULT_CONDITIONS,
): string | null {
  const key = normalizeSubpath(subpath);

  // string export
  if (typeof exports === "string") {
    return key === "." ? exports : null;
  }

  if (!exports || typeof exports !== "object") return null;

  const exp = exports as Record<string, unknown>;

  // exact match
  if (exp[key] !== undefined) {
    return resolveCondition(exp[key], conditions);
  }

  // pattern match
  for (const [pattern, target] of Object.entries(exp)) {
    if (!pattern.includes("*")) continue;

    const [base] = pattern.split("*");
    if (key.startsWith(base)) {
      const r = resolveCondition(target, conditions);
      if (typeof r === "string") {
        return r.replace("*", key.slice(base.length));
      }
    }
  }

  // fallback "." export
  if (exp["."]) {
    return resolveCondition(exp["."], conditions);
  }

  return null;
}

function resolveCondition(
  target: unknown,
  conditions: string[],
): string | null {
  if (typeof target === "string") return target;

  if (Array.isArray(target)) {
    for (const t of target) {
      const r = resolveCondition(t, conditions);
      if (r) return r;
    }
    return null;
  }

  if (target && typeof target === "object") {
    const obj = target as Record<string, unknown>;

    for (const c of conditions) {
      if (obj[c] !== undefined) {
        const r = resolveCondition(obj[c], conditions);
        if (r) return r;
      }
    }

    // fallback default
    if (obj.default !== undefined) {
      return resolveCondition(obj.default, conditions);
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────
// entry resolver

function resolveEntry(pkg: Record<string, any>) {
  if (pkg.exports) {
    const r = resolveExports(pkg.exports, ".");
    if (r) return r;
  }

  if (pkg.module) return pkg.module;
  if (pkg.main) return pkg.main;

  return "index.js";
}

// ─────────────────────────────────────────────────────────
// CDN path

export async function resolveCdnPath(
  pkgName: string,
  version: string,
  subpath = ".",
) {
  const r = await fetch(`${CDN_BASE}/${pkgName}@${version}/package.json`);
  if (!r.ok) throw new Error(`CDN: ${pkgName}@${version} not found`);

  const pkg = await r.json();

  let entry: string | null = null;

  if (pkg.exports) {
    entry = resolveExports(pkg.exports, subpath);
  }

  if (!entry) {
    if (subpath === ".") {
      entry = resolveEntry(pkg);
    } else {
      entry = subpath;
    }
  }

  entry = stripDotSlash(entry);

  return `${CDN_BASE}/${pkgName}@${version}/${entry}`;
}

// ─────────────────────────────────────────────────────────
// fetch

export async function fetchFromCdn(
  pkgName: string,
  version: string,
  subpath = ".",
) {
  const url = await resolveCdnPath(pkgName, version, subpath);

  const r = await fetch(url);
  if (!r.ok) throw new Error(`CDN fetch failed: ${url}`);

  return new Uint8Array(await r.arrayBuffer());
}

// ─────────────────────────────────────────────────────────
// collect exports files (fix nhẹ)

function collectExportedFilePaths(pkg: Record<string, unknown>): string[] {
  const paths = new Set<string>();

  function walk(node: unknown) {
    if (typeof node === "string") {
      const p = stripDotSlash(node);

      if (!p.includes("*") && /\.(js|mjs|cjs)$/.test(p)) {
        paths.add(p);
      }
      return;
    }

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    if (node && typeof node === "object") {
      Object.values(node as Record<string, unknown>).forEach(walk);
    }
  }

  if (pkg.exports) walk(pkg.exports);
  if (pkg.module) walk(pkg.module);
  if (pkg.main) walk(pkg.main);

  return [...paths];
}

// ─────────────────────────────────────────────────────────
// multi fetch

export async function fetchExportedFilesFromCdn(
  pkgName: string,
  version: string,
  realPkg: Record<string, unknown>,
) {
  const filePaths = collectExportedFilePaths(realPkg).slice(0, 30);

  const results = await Promise.allSettled(
    filePaths.map(async (filePath) => {
      const res = await fetch(`${CDN_BASE}/${pkgName}@${version}/${filePath}`);
      if (!res.ok) throw new Error("not ok");

      return {
        path: filePath,
        bytes: new Uint8Array(await res.arrayBuffer()),
      };
    }),
  );

  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

// ─────────────────────────────────────────────────────────
// entry fetch

export async function fetchEntryFromCdn(pkgName: string, version: string) {
  const r = await fetch(`${CDN_BASE}/${pkgName}@${version}/package.json`);
  if (!r.ok) throw new Error(`CDN: ${pkgName}@${version} not found`);

  const pkg = await r.json();

  let entry = resolveEntry(pkg);
  entry = stripDotSlash(entry);

  const url = `${CDN_BASE}/${pkgName}@${version}/${entry}`;

  const r2 = await fetch(url);
  if (!r2.ok) throw new Error(`CDN fetch failed: ${url}`);

  return {
    entry,
    bytes: new Uint8Array(await r2.arrayBuffer()),
    pkg: pkg as Record<string, unknown>,
  };
}
