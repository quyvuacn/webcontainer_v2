/**
 * Node CLI — runNode for shell integration.
 */

export { preloadEsbuildWasm } from "./transform/esm-to-cjs";
import { PathUtils } from "./vfs/core/path";
import { ensureInit, preloadEsbuildWasm } from "./transform/esm-to-cjs";
import type { VirtualFS } from "./vfs/core/vfs";
import type { FileSource } from "./file-source/types";
import { ModuleResolver, BROWSER_ALIAS } from "./module-system/resolver";
import { ModuleCache } from "./module-system/cache";
import { CJSLoader } from "./module-system/cjs-loader";
import { createBuiltinMap } from "./module-system/builtins";
import {
  ProcessPolyfill,
  ProcessExitError,
  type TerminalLike,
} from "./polyfills/process";
import { createSetupVirtualPortHook } from "./polyfills/node-runtime-hooks";
import { NODE_VERSION } from "./version";
import {
  WC_EMIT_SIGINT,
  WC_PROCESS_STACK,
  WC_EXIT_RESOLVE,
  WC_ACTIVE_HANDLE_COUNT,
  WC_ESBUILD_WASM_MODULE,
  WC_HAS_TCP_REG,
  WC_PUSH_STDIN,
  WC_STDIN_RAW,
} from "../js/lib/wc_globals";

export interface RunNodeOptions {
  cwd?: string;
  env?: Record<string, string>;
  fileSource?: FileSource;
}

export type { TerminalLike };

/**
 * Run Node.js script. Returns exit code.
 */
export async function runNode(
  args: string[],
  vfs: VirtualFS,
  terminal: TerminalLike,
  opts?: RunNodeOptions,
): Promise<number> {
  const cwd = PathUtils.normalize(opts?.cwd ?? "/");
  const env = opts?.env ?? {};

  if (args.length === 0) {
    (terminal.writeError ?? terminal.write)(
      "node: usage: node <file> [args...] or node -e <code>\n",
    );
    return 1;
  }

  // node --version / -v
  if (args[0] === "--version" || args[0] === "-v") {
    terminal.write(NODE_VERSION + "\n");
    return 0;
  }

  // node --help / -h
  if (args[0] === "--help" || args[0] === "-h") {
    terminal.write("Usage: node [options] <file> [args...]\n");
    terminal.write("  -e, --eval <code>  evaluate code\n");
    terminal.write("  -v, --version      print version\n");
    return 0;
  }

  let entryFile: string;
  let scriptArgs: string[];

  // node -e "code"
  if (args[0] === "--eval" || args[0] === "-e") {
    const code = args[1];
    if (!code) {
      (terminal.writeError ?? terminal.write)(
        "node: -e requires an argument\n",
      );
      return 1;
    }
    const tmpFile = `/tmp/__eval_${Date.now()}.js`;
    await vfs.mkdir("/tmp", { recursive: true });
    await vfs.writeFile(tmpFile, code);
    entryFile = tmpFile;
    scriptArgs = args.slice(2);
  } else {
    entryFile = args[0]!;
    scriptArgs = args.slice(1);
  }

  const resolvedPath = PathUtils.isAbsolute(entryFile)
    ? PathUtils.normalize(entryFile)
    : PathUtils.join(cwd, entryFile);

  if (!(await vfs.exists(resolvedPath))) {
    (terminal.writeError ?? terminal.write)(
      `node: cannot open ${entryFile}: No such file or directory\n`,
    );
    return 1;
  }

  const process = new ProcessPolyfill(
    cwd,
    ["node", entryFile, ...scriptArgs],
    { ...env, NODE_ENV: env.NODE_ENV ?? "development" },
    terminal,
  );

  const g = globalThis as Record<string, unknown>;
  if (!g.__setupVirtualPort && !(g[WC_HAS_TCP_REG] as boolean))
    g.__setupVirtualPort = createSetupVirtualPortHook();
  const stack = (g[WC_PROCESS_STACK] as ProcessPolyfill[]) ?? [];
  stack.push(process);
  g[WC_PROCESS_STACK] = stack;
  g[WC_EMIT_SIGINT] = () => {
    const s = g[WC_PROCESS_STACK] as ProcessPolyfill[];
    if (!s?.length) return;
    const p = s.pop()!;
    try {
      if (p.listenerCount("SIGINT") > 0) p.emit("SIGINT");
      else p.exit(130);
    } catch {
      (g[WC_EMIT_SIGINT] as (() => void) | undefined)?.();
    }
  };
  g[WC_PUSH_STDIN] = (d: string | null) => process.stdin.push(d);
  g[WC_STDIN_RAW] = () => process.stdin._rawMode;

  const fileSource = opts?.fileSource;
  const resolver = new ModuleResolver(vfs, {
    conditions: ["require", "node", "default"],
    alias: typeof location !== "undefined" ? BROWSER_ALIAS : {},
  });
  const cache = new ModuleCache();
  const syncCache = new Map<string, string | Uint8Array>();
  const builtins = createBuiltinMap(
    vfs,
    process,
    () => process.cwd(),
    syncCache,
    fileSource,
  );
  const loader = new CJSLoader(
    vfs,
    resolver,
    cache,
    builtins,
    process,
    syncCache,
    fileSource,
  );

  g[WC_ACTIVE_HANDLE_COUNT] = 0;
  const exitPromise = new Promise<number>((resolve) => {
    g[WC_EXIT_RESOLVE] = resolve;
  });
  const timers = (builtins.get("node:timers") ?? builtins.get("timers")) as
    | {
        setTimeout?: typeof globalThis.setTimeout;
        clearTimeout?: typeof globalThis.clearTimeout;
        setInterval?: typeof globalThis.setInterval;
        clearInterval?: typeof globalThis.clearInterval;
      }
    | undefined;
  if (timers?.setTimeout) g.setTimeout = timers.setTimeout;
  if (timers?.clearTimeout) g.clearTimeout = timers.clearTimeout;
  if (timers?.setInterval) g.setInterval = timers.setInterval;
  if (timers?.clearInterval) g.clearInterval = timers.clearInterval;
  const fsMod = builtins.get("node:fs") ?? builtins.get("fs");
  if (fsMod) g.fs = fsMod;
  const pathMod = builtins.get("node:path") ?? builtins.get("path");
  if (pathMod) g.path = pathMod;
  const bufMod = (builtins.get("node:buffer") ?? builtins.get("buffer")) as
    | { Buffer?: unknown }
    | undefined;
  if (bufMod?.Buffer) g.Buffer = bufMod.Buffer;
  g.process = process;

  try {
    if (typeof location !== "undefined" && !g[WC_ESBUILD_WASM_MODULE])
      await preloadEsbuildWasm();
    await ensureInit();
    await loader.run(resolvedPath, cwd);
    if ((g[WC_ACTIVE_HANDLE_COUNT] as number) > 0) return await exitPromise;
    return 0;
  } catch (err) {
    if (err instanceof ProcessExitError) {
      return err.code;
    }
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    (terminal.writeError ?? terminal.write)(`${msg}\n`);
    return 1;
  } finally {
    const s = g[WC_PROCESS_STACK] as ProcessPolyfill[];
    if (s?.length && s[s.length - 1] === process) s.pop();
    if (!s?.length) delete g[WC_EMIT_SIGINT];
    delete g[WC_PUSH_STDIN];
    delete g[WC_STDIN_RAW];
  }
}

/**
 * Create a spawnNode function for Shell integration.
 */
export function createNodeSpawner(
  vfs: VirtualFS,
  write: (text: string) => void,
  writeError?: (text: string) => void,
  fileSource?: FileSource,
): (
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string> },
) => Promise<number> {
  const terminal: TerminalLike = writeError ? { write, writeError } : { write };
  return (args, opts) =>
    runNode(args, vfs, terminal, fileSource ? { ...opts, fileSource } : opts);
}
