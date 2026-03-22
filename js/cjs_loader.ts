const RE_REQUIRE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export function hasRequire(code: string) {
  return /require\s*\(|module\.exports|exports\./.test(code);
}

export function transformRequireToAsync(code: string) {
  return code.replace(RE_REQUIRE, "(await __req__(`$1`))");
}

function dirname(path: string) {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

async function resolvePath(
  vfsRead: (p: string) => Promise<Uint8Array | null>,
  request: string,
  parentDir: string,
  projectRoot: string,
) {
  if (request.startsWith(".")) {
    const base = parentDir ? `${parentDir}/` : "";
    const p = base + request.replace(/^\.[\\/]/, "");
    for (const ext of ["", ".js", "/index.js"]) {
      const full = p + ext;
      const b = await vfsRead(full);
      if (b) return full;
    }
    return null;
  }
  const parts = request.split("/");
  const name = parts[0].startsWith("@")
    ? parts.slice(0, 2).join("/")
    : parts[0];
  const subpath = parts[0].startsWith("@")
    ? parts.slice(2).join("/")
    : parts.slice(1).join("/");
  const dir = `${projectRoot}/node_modules/${name}`;
  const pkgBytes = await vfsRead(`${dir}/package.json`);
  if (!pkgBytes) return null;
  const pkg = JSON.parse(new TextDecoder().decode(pkgBytes));
  let entry = pkg.main || "index.js";
  const exp = pkg.exports;
  if (exp && typeof exp === "object" && exp["."]) {
    const e = exp["."];
    entry = typeof e === "string" ? e : e?.require || e?.default || entry;
  }
  const base = subpath ? `${dir}/${subpath}` : `${dir}/${entry}`;
  for (const ext of ["", ".js", "/index.js"]) {
    const full = base + (base.endsWith(".js") ? "" : ext);
    const b = await vfsRead(full);
    if (b) return full;
  }
  return null;
}

export function createRequire(
  vfsRead: (p: string) => Promise<Uint8Array | null>,
  projectRoot = "project",
) {
  const cache = new Map<string, unknown>();

  async function load(path: string) {
    if (cache.has(path)) return cache.get(path);
    const bytes = await vfsRead(path);
    if (!bytes) throw new Error(`Cannot find module '${path}'`);
    const code = new TextDecoder().decode(bytes);
    const __dirname = dirname(path);
    const __filename = path;
    const mod = { exports: {} as Record<string, unknown> };

    const transformed = hasRequire(code) ? transformRequireToAsync(code) : code;
    const fn = new Function(
      "exports",
      "module",
      "__filename",
      "__dirname",
      "__req__",
      `return (async function() { ${transformed}; return module.exports })()`,
    );
    const req = async (id: string) => {
      const resolved = await resolvePath(vfsRead, id, __dirname, projectRoot);
      if (!resolved) throw new Error(`Cannot find module '${id}'`);
      return load(resolved);
    };
    const result = await fn(mod.exports, mod, __filename, __dirname, req);
    cache.set(path, result ?? mod.exports);
    return cache.get(path);
  }

  return async (request: string) => {
    const path = await resolvePath(vfsRead, request, "", projectRoot);
    if (!path) throw new Error(`Cannot find module '${request}'`);
    return load(path);
  };
}
