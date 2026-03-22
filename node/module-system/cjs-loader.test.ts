import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryVfs } from "../vfs/test-memory";
import { ModuleResolver } from "./resolver";
import { ModuleCache } from "./cache";
import { CJSLoader } from "./cjs-loader";
import { createBuiltinMap } from "./builtins";
import { ProcessPolyfill } from "../polyfills/process";

describe("CJSLoader", () => {
  let vfs: ReturnType<typeof createMemoryVfs>;
  let process: ProcessPolyfill;
  let loader: CJSLoader;

  beforeEach(() => {
    vfs = createMemoryVfs();

    const terminal = { write: () => {}, writeError: () => {} };
    process = new ProcessPolyfill(
      "/project",
      ["node", "index.js"],
      { NODE_ENV: "test" },
      terminal,
    );

    const resolver = new ModuleResolver(vfs);
    const cache = new ModuleCache();
    const builtins = createBuiltinMap(vfs, process, () => process.cwd());

    loader = new CJSLoader(vfs, resolver, cache, builtins, process);
  });

  it("loads JSON module", async () => {
    await vfs.mkdir("/project", { recursive: true });
    await vfs.writeFile("/project/data.json", JSON.stringify({ foo: 42 }));

    const exports = await loader.load("/project/data.json", "/project");
    expect(exports).toEqual({ foo: 42 });
  });

  it("loads CJS module with module.exports", async () => {
    await vfs.mkdir("/project", { recursive: true });
    await vfs.writeFile("/project/foo.js", "module.exports = { x: 1, y: 2 }");

    const exports = await loader.load("/project/foo.js", "/project");
    expect(exports).toEqual({ x: 1, y: 2 });
  });

  it("loads CJS module with require (transformed to async)", async () => {
    await vfs.mkdir("/project", { recursive: true });
    await vfs.writeFile("/project/bar.js", "module.exports = { value: 100 }");
    await vfs.writeFile(
      "/project/main.js",
      "const bar = require('./bar.js'); module.exports = { doubled: bar.value * 2 }",
    );

    const exports = await loader.load("/project/main.js", "/project");
    expect(exports).toEqual({ doubled: 200 });
  });

  it("loads built-in path module", async () => {
    const path = await loader.load("path", "/project");
    expect(path).toBeDefined();
    expect(
      typeof (path as { join: (a: string, b: string) => string }).join,
    ).toBe("function");
  });
});
