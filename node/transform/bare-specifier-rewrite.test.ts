import { describe, it, expect, vi, beforeEach } from "vitest";
import { rewriteBareSpecifiersInModule } from "./bare-specifier-rewrite";
import type { VirtualFS } from "../vfs/core/vfs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal VFS stub — tests that need resolution can extend this. */
function makeVfs(files: Record<string, string> = {}): VirtualFS {
  return {
    readFile: vi.fn(async (p: string) => files[p] ?? ""),
    exists: vi.fn(async (p: string) => p in files),
  } as unknown as VirtualFS;
}

/**
 * Mock ModuleResolver so tests don't depend on actual FS resolution.
 * resolveMap: specifier → resolved absolute path (without prefix).
 */
function mockResolver(resolveMap: Record<string, string> = {}) {
  return vi.fn().mockImplementation((_vfs: unknown, _opts: unknown) => ({
    resolve: vi.fn(async (spec: string) => {
      if (spec in resolveMap) return resolveMap[spec];
      throw new Error(`Cannot resolve: ${spec}`);
    }),
  }));
}

// We mock the module-system/resolver module so ModuleResolver is controllable.
vi.mock("../module-system/resolver", () => ({
  isBuiltinModule: (spec: string) => spec.startsWith("node:"),
  BROWSER_ALIAS: {},
  ModuleResolver: class {
    private map: Record<string, string>;
    constructor(_vfs: unknown, _opts: unknown) {
      // Each test suite injects its own resolve map via the module-level variable.
      this.map = currentResolveMap;
    }
    async resolve(spec: string): Promise<string> {
      const resolved = this.map[spec];
      if (resolved !== undefined) return resolved;
      throw new Error(`Cannot resolve: ${spec}`);
    }
  },
}));

// Module-level variable tests write to before calling rewriteBareSpecifiersInModule.
let currentResolveMap: Record<string, string> = {};

function withResolveMap(map: Record<string, string>) {
  currentResolveMap = map;
}

const vfs = makeVfs();
const FROM = "/project/src/entry.js";
const PREFIX = "/__wc__";

async function rewrite(source: string, opts?: { pathPrefix?: string }) {
  return rewriteBareSpecifiersInModule(source, FROM, vfs, {
    pathPrefix: opts?.pathPrefix ?? PREFIX + "/",
  });
}

// ---------------------------------------------------------------------------
// No-op cases
// ---------------------------------------------------------------------------

describe("no-op: source returned unchanged", () => {
  it("empty source", async () => {
    expect(await rewrite("")).toBe("");
  });

  it("source with no import/export statements", async () => {
    const src = `const x = 1\nconsole.log(x)`;
    expect(await rewrite(src)).toBe(src);
  });

  it("only relative imports — nothing to rewrite", async () => {
    withResolveMap({});
    const src = `import foo from './foo'\nimport bar from '../bar'`;
    expect(await rewrite(src)).toBe(src);
  });

  it("only already-absolute /__wc__ imports", async () => {
    const src = `import x from '/__wc__/project/node_modules/vite/index.js'`;
    expect(await rewrite(src)).toBe(src);
  });

  it("https: protocol specifier — unchanged", async () => {
    const src = `import x from 'https://cdn.skypack.dev/lodash'`;
    expect(await rewrite(src)).toBe(src);
  });

  it("data: protocol specifier — unchanged", async () => {
    const src = `import x from 'data:text/javascript,export default 1'`;
    expect(await rewrite(src)).toBe(src);
  });

  it("blob: protocol specifier — unchanged", async () => {
    const src = `import x from 'blob:https://example.com/abc'`;
    expect(await rewrite(src)).toBe(src);
  });
});

// ---------------------------------------------------------------------------
// Node built-ins — bare form ("fs", "path", …)
// ---------------------------------------------------------------------------

describe("bare Node builtins", () => {
  it('rewrites bare "fs"', async () => {
    const result = await rewrite(`import fs from 'fs'`);
    expect(result).toBe(`import fs from '/__wc__/builtin/fs'`);
  });

  it('rewrites bare "path"', async () => {
    const result = await rewrite(`import path from 'path'`);
    expect(result).toBe(`import path from '/__wc__/builtin/path'`);
  });

  it('rewrites bare "crypto"', async () => {
    const result = await rewrite(`import { createHash } from 'crypto'`);
    expect(result).toBe(`import { createHash } from '/__wc__/builtin/crypto'`);
  });

  it('rewrites bare "events"', async () => {
    const result = await rewrite(`import { EventEmitter } from 'events'`);
    expect(result).toBe(
      `import { EventEmitter } from '/__wc__/builtin/events'`,
    );
  });

  it("rewrites all builtins in the NODE_BUILTINS set", async () => {
    const builtins = [
      "assert",
      "async_hooks",
      "buffer",
      "child_process",
      "cluster",
      "console",
      "crypto",
      "dns",
      "events",
      "fs",
      "http",
      "https",
      "module",
      "net",
      "os",
      "path",
      "perf_hooks",
      "querystring",
      "readline",
      "stream",
      "string_decoder",
      "tls",
      "tty",
      "url",
      "util",
      "v8",
      "worker_threads",
      "zlib",
    ];
    for (const b of builtins) {
      const result = await rewrite(`import x from '${b}'`);
      expect(result, `builtin: ${b}`).toBe(
        `import x from '/__wc__/builtin/${b}'`,
      );
    }
  });

  it("rewrites double-quoted bare builtin", async () => {
    const result = await rewrite(`import fs from "fs"`);
    expect(result).toBe(`import fs from "/__wc__/builtin/fs"`);
  });
});

// ---------------------------------------------------------------------------
// Node built-ins — node: prefix form ("node:fs", "node:path", …)
// ---------------------------------------------------------------------------

describe("node:-prefixed builtins", () => {
  it('rewrites "node:fs"', async () => {
    const result = await rewrite(`import fs from 'node:fs'`);
    expect(result).toBe(`import fs from '/__wc__/builtin/fs'`);
  });

  it('rewrites "node:path"', async () => {
    const result = await rewrite(`import path from 'node:path'`);
    expect(result).toBe(`import path from '/__wc__/builtin/path'`);
  });

  it('rewrites "node:child_process"', async () => {
    const result = await rewrite(
      `import { spawnSync } from 'node:child_process'`,
    );
    expect(result).toBe(
      `import { spawnSync } from '/__wc__/builtin/child_process'`,
    );
  });

  it('rewrites "node:fs/promises" sub-path', async () => {
    const result = await rewrite(`import fsp from 'node:fs/promises'`);
    expect(result).toBe(`import fsp from '/__wc__/builtin/fs/promises'`);
  });

  it('rewrites "node:fs" double-quoted', async () => {
    const result = await rewrite(`import fs from "node:fs"`);
    expect(result).toBe(`import fs from "/__wc__/builtin/fs"`);
  });

  it("rewrites both node:fs and node:fs/promises in same file — longer spec first", async () => {
    const src = [
      `import fs from 'node:fs'`,
      `import fsp from 'node:fs/promises'`,
    ].join("\n");
    const result = await rewrite(src);
    expect(result).toBe(
      [
        `import fs from '/__wc__/builtin/fs'`,
        `import fsp from '/__wc__/builtin/fs/promises'`,
      ].join("\n"),
    );
  });
});

// ---------------------------------------------------------------------------
// Minified / complex import binding shapes (the $-in-name regression)
// ---------------------------------------------------------------------------

describe('minified binding names containing "$"', () => {
  it('rewrites when default alias contains "$" (fs$j)', async () => {
    const result = await rewrite(`import * as fs$j from 'fs'`);
    expect(result).toBe(`import * as fs$j from '/__wc__/builtin/fs'`);
  });

  it('rewrites mixed default + named with "$" aliases', async () => {
    const src = `import fs__default, { promises as promises$1 } from 'node:fs'`;
    const result = await rewrite(src);
    expect(result).toBe(
      `import fs__default, { promises as promises$1 } from '/__wc__/builtin/fs'`,
    );
  });

  it('rewrites when multiple "$" aliases in same statement', async () => {
    const src = `import fsp, { lstat as lstat$3, readdir as readdir$5 } from 'node:fs/promises'`;
    const result = await rewrite(src);
    expect(result).toBe(
      `import fsp, { lstat as lstat$3, readdir as readdir$5 } from '/__wc__/builtin/fs/promises'`,
    );
  });

  it('does not corrupt "$" in binding names when resolving bare packages', async () => {
    withResolveMap({ "some-pkg": "/project/node_modules/some-pkg/index.js" });
    const src = `import { thing as thing$1 } from 'some-pkg'`;
    const result = await rewrite(src);
    expect(result).toBe(
      `import { thing as thing$1 } from '/__wc__/project/node_modules/some-pkg/index.js'`,
    );
  });

  it("rewrites all occurrences of same specifier (multiple import styles)", async () => {
    const src = [
      `import * as fs$j from 'node:fs'`,
      `import fs__default, { promises as promises$1 } from 'node:fs'`,
      `import { readFileSync } from 'node:fs'`,
    ].join("\n");
    const result = await rewrite(src);
    expect(result).toBe(
      [
        `import * as fs$j from '/__wc__/builtin/fs'`,
        `import fs__default, { promises as promises$1 } from '/__wc__/builtin/fs'`,
        `import { readFileSync } from '/__wc__/builtin/fs'`,
      ].join("\n"),
    );
  });

  it("rewrites same specifier with mixed quotes (single and double)", async () => {
    const src = [`import fs1 from 'node:fs'`, `import fs2 from "node:fs"`].join(
      "\n",
    );
    const result = await rewrite(src);
    expect(result).toBe(
      [
        `import fs1 from '/__wc__/builtin/fs'`,
        `import fs2 from "/__wc__/builtin/fs"`,
      ].join("\n"),
    );
  });
});

// ---------------------------------------------------------------------------
// Bare package names (non-builtins)
// ---------------------------------------------------------------------------

describe("bare package names", () => {
  it("rewrites a bare package resolved by ModuleResolver", async () => {
    withResolveMap({ vite: "/project/node_modules/vite/index.cjs" });
    const result = await rewrite(`import { defineConfig } from 'vite'`);
    expect(result).toBe(
      `import { defineConfig } from '/__wc__/project/node_modules/vite/index.cjs'`,
    );
  });

  it("rewrites a scoped package", async () => {
    withResolveMap({
      "@scope/pkg": "/project/node_modules/@scope/pkg/index.js",
    });
    const result = await rewrite(`import x from '@scope/pkg'`);
    expect(result).toBe(
      `import x from '/__wc__/project/node_modules/@scope/pkg/index.js'`,
    );
  });

  it("leaves specifier unchanged when resolver throws", async () => {
    withResolveMap({}); // nothing resolves
    const src = `import x from 'unresolvable-pkg'`;
    expect(await rewrite(src)).toBe(src);
  });

  it("deduplicates: resolves same specifier only once", async () => {
    const resolveFn = vi.fn(
      async () => "/project/node_modules/lodash/index.js",
    );
    currentResolveMap = new Proxy({}, { get: (_t, _k) => resolveFn }) as never;
    const src = [
      `import map from 'lodash'`,
      `import filter from 'lodash'`,
    ].join("\n");
    await rewrite(src);
    expect(resolveFn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Absolute specifiers (/…)
// ---------------------------------------------------------------------------

describe("absolute specifiers", () => {
  it("rewrites /absolute/path", async () => {
    const result = await rewrite(`import x from '/absolute/path/mod.js'`);
    expect(result).toBe(`import x from '/__wc__/absolute/path/mod.js'`);
  });

  it("does not double-prefix already-prefixed absolute path", async () => {
    const src = `import x from '/__wc__/already/prefixed.js'`;
    expect(await rewrite(src)).toBe(src);
  });
});

// ---------------------------------------------------------------------------
// Export statements
// ---------------------------------------------------------------------------

describe("export … from", () => {
  it("rewrites named re-export from builtin", async () => {
    const result = await rewrite(`export { readFile } from 'fs'`);
    expect(result).toBe(`export { readFile } from '/__wc__/builtin/fs'`);
  });

  it("rewrites namespace re-export from package", async () => {
    withResolveMap({ lodash: "/project/node_modules/lodash/index.js" });
    const result = await rewrite(`export * from 'lodash'`);
    expect(result).toBe(
      `export * from '/__wc__/project/node_modules/lodash/index.js'`,
    );
  });

  it('rewrites export … from with "$" alias names', async () => {
    const result = await rewrite(
      `export { parseAst, parseAstAsync } from 'node:fs'`,
    );
    expect(result).toBe(
      `export { parseAst, parseAstAsync } from '/__wc__/builtin/fs'`,
    );
  });
});

// ---------------------------------------------------------------------------
// Dynamic imports
// ---------------------------------------------------------------------------

describe('side-effect import (import "pkg")', () => {
  it("rewrites side-effect import of builtin", async () => {
    const result = await rewrite(`import 'fs'`);
    expect(result).toBe(`import '/__wc__/builtin/fs'`);
  });

  it("rewrites side-effect import of node: builtin", async () => {
    const result = await rewrite(`import "node:path"`);
    expect(result).toBe(`import "/__wc__/builtin/path"`);
  });
});

// ---------------------------------------------------------------------------
// Dynamic imports
// ---------------------------------------------------------------------------

describe("dynamic import()", () => {
  it("rewrites dynamic import of builtin", async () => {
    const result = await rewrite(`const m = await import('fs')`);
    expect(result).toBe(`const m = await import('/__wc__/builtin/fs')`);
  });

  it("rewrites dynamic import of node: builtin", async () => {
    const result = await rewrite(`const m = await import('node:path')`);
    expect(result).toBe(`const m = await import('/__wc__/builtin/path')`);
  });

  it("rewrites dynamic import of bare package", async () => {
    withResolveMap({ react: "/project/node_modules/react/index.js" });
    const result = await rewrite(`const r = await import('react')`);
    expect(result).toBe(
      `const r = await import('/__wc__/project/node_modules/react/index.js')`,
    );
  });

  it("leaves https: dynamic import unchanged", async () => {
    const src = `const m = await import('https://cdn.skypack.dev/react')`;
    expect(await rewrite(src)).toBe(src);
  });
});

// ---------------------------------------------------------------------------
// Mixed source (multiple specifiers, mixed types)
// ---------------------------------------------------------------------------

describe("mixed source files", () => {
  it("rewrites multiple different builtins in one file", async () => {
    const src = [
      `import fs from 'fs'`,
      `import path from 'path'`,
      `import { EventEmitter } from 'events'`,
    ].join("\n");
    const result = await rewrite(src);
    expect(result).toBe(
      [
        `import fs from '/__wc__/builtin/fs'`,
        `import path from '/__wc__/builtin/path'`,
        `import { EventEmitter } from '/__wc__/builtin/events'`,
      ].join("\n"),
    );
  });

  it("rewrites builtins and packages, leaves relative and https untouched", async () => {
    withResolveMap({ vite: "/project/node_modules/vite/index.cjs" });
    const src = [
      `import path from 'node:path'`,
      `import { defineConfig } from 'vite'`,
      `import local from './local'`,
      `import remote from 'https://cdn.skypack.dev/x'`,
    ].join("\n");
    const result = await rewrite(src);
    expect(result).toBe(
      [
        `import path from '/__wc__/builtin/path'`,
        `import { defineConfig } from '/__wc__/project/node_modules/vite/index.cjs'`,
        `import local from './local'`,
        `import remote from 'https://cdn.skypack.dev/x'`,
      ].join("\n"),
    );
  });

  it("handles the real-world dep-BK3b2jBa.js pattern (the original regression)", async () => {
    // This is the exact pattern from the failing log that triggered the bug fixes.
    const src = [
      `import * as fs$j from '/__wc__/builtin/fs'`, // already rewritten → unchanged
      `import fs__default, { promises as promises$1 } from 'node:fs'`, // must rewrite
      `import fsp, { lstat as lstat$3, readdir as readdir$5, readlink, realpath as realpath$2 } from '/__wc__/builtin/fs/promises'`, // already rewritten → unchanged
    ].join("\n");
    const result = await rewrite(src);
    expect(result).toBe(
      [
        `import * as fs$j from '/__wc__/builtin/fs'`,
        `import fs__default, { promises as promises$1 } from '/__wc__/builtin/fs'`,
        `import fsp, { lstat as lstat$3, readdir as readdir$5, readlink, realpath as realpath$2 } from '/__wc__/builtin/fs/promises'`,
      ].join("\n"),
    );
  });
});

// ---------------------------------------------------------------------------
// Custom pathPrefix option
// ---------------------------------------------------------------------------

describe("custom pathPrefix", () => {
  it("uses custom prefix", async () => {
    const result = await rewriteBareSpecifiersInModule(
      `import fs from 'fs'`,
      FROM,
      vfs,
      { pathPrefix: "/custom/prefix/" },
    );
    expect(result).toBe(`import fs from '/custom/prefix/builtin/fs'`);
  });

  it("works without trailing slash in prefix", async () => {
    const result = await rewriteBareSpecifiersInModule(
      `import fs from 'fs'`,
      FROM,
      vfs,
      { pathPrefix: "/no-trailing-slash" },
    );
    expect(result).toBe(`import fs from '/no-trailing-slash/builtin/fs'`);
  });

  it("does not double-slash when prefix already ends with /", async () => {
    const result = await rewriteBareSpecifiersInModule(
      `import path from 'path'`,
      FROM,
      vfs,
      { pathPrefix: "/__wc__/" },
    );
    expect(result).not.toContain("//");
    expect(result).toBe(`import path from '/__wc__/builtin/path'`);
  });
});
