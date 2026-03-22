/**
 * esbuild plugin to resolve modules from VFS and inject Node builtins.
 * Used when bundling ESM with top-level await (CJS format doesn't support it).
 */

import { PathUtils } from "../vfs/core/path";
import type { VirtualFS } from "../vfs/core/vfs";
import type { ModuleResolver } from "../module-system/resolver";
import type { FileSource } from "../file-source/types";
import type { Plugin } from "esbuild-wasm";

const BUILTINS = new Set([
  "fs",
  "fs/promises",
  "path",
  "process",
  "os",
  "events",
  "stream",
  "buffer",
  "crypto",
  "url",
  "util",
  "assert",
  "http",
  "https",
  "child_process",
  "tty",
  "worker_threads",
  "net",
  "querystring",
  "string_decoder",
  "zlib",
  "timers",
  "perf_hooks",
  "dns",
  "dgram",
  "cluster",
  "readline",
  "repl",
  "vm",
  "inspector",
  "module",
  "v8",
  "tls",
  "http2",
  "node:fs",
  "node:path",
  "node:process",
  "node:os",
  "node:events",
  "node:stream",
  "node:buffer",
  "node:crypto",
  "node:url",
  "node:util",
  "node:assert",
  "node:http",
  "node:https",
  "node:child_process",
  "node:worker_threads",
  "node:tty",
  "node:inspector",
  "node:module",
  "node:v8",
  "node:tls",
  "node:http2",
]);

import {
  STUB_PACKAGES,
  getStubContentsForBundle,
} from "../module-system/stub-packages";

// Map to globalThis (injected by CJSLoader before bundle runs)
const GLOBAL_MODULES = new Set(["esbuild"]);

// Named exports for each builtin — required for `import { X } from 'node:Y'` to resolve at bundle time
const BUILTIN_NAMED_EXPORTS: Record<string, string[]> = {
  "node:perf_hooks": [
    "performance",
    "PerformanceObserver",
    "monitorEventLoopDelay",
    "createHistogram",
    "constants",
  ],
  perf_hooks: [
    "performance",
    "PerformanceObserver",
    "monitorEventLoopDelay",
    "createHistogram",
    "constants",
  ],
  "node:url": [
    "fileURLToPath",
    "pathToFileURL",
    "URL",
    "URLSearchParams",
    "parse",
    "format",
    "resolve",
  ],
  url: [
    "fileURLToPath",
    "pathToFileURL",
    "URL",
    "URLSearchParams",
    "parse",
    "format",
    "resolve",
  ],
  "node:path": [
    "dirname",
    "join",
    "resolve",
    "basename",
    "extname",
    "normalize",
    "relative",
    "isAbsolute",
    "sep",
    "delimiter",
    "posix",
    "win32",
  ],
  path: [
    "dirname",
    "join",
    "resolve",
    "basename",
    "extname",
    "normalize",
    "relative",
    "isAbsolute",
    "sep",
    "delimiter",
    "posix",
    "win32",
  ],
  "node:module": [
    "createRequire",
    "createRequireFromPath",
    "Module",
    "runMain",
    "wrap",
    "builtinModules",
    "isBuiltin",
  ],
  module: [
    "createRequire",
    "createRequireFromPath",
    "Module",
    "runMain",
    "wrap",
    "builtinModules",
    "isBuiltin",
  ],
  "node:fs": [
    "promises",
    "readFileSync",
    "writeFileSync",
    "writeSync",
    "readFile",
    "writeFile",
    "open",
    "close",
    "read",
    "write",
    "mkdir",
    "readdir",
    "stat",
    "exists",
    "constants",
    "unlink",
    "rmdir",
    "rm",
    "rename",
    "copyFile",
    "watch",
    "lstat",
    "appendFile",
    "readlink",
    "realpath",
    "lstatSync",
    "readdirSync",
    "readlinkSync",
    "realpathSync",
    "existsSync",
    "statSync",
    "mkdirSync",
    "unlinkSync",
    "rmdirSync",
  ],
  fs: [
    "promises",
    "readFileSync",
    "writeFileSync",
    "writeSync",
    "readFile",
    "writeFile",
    "open",
    "close",
    "read",
    "write",
    "mkdir",
    "readdir",
    "stat",
    "exists",
    "constants",
    "unlink",
    "rmdir",
    "rm",
    "rename",
    "copyFile",
    "watch",
    "lstat",
    "appendFile",
    "readlink",
    "realpath",
    "lstatSync",
    "readdirSync",
    "readlinkSync",
    "realpathSync",
    "existsSync",
    "statSync",
    "mkdirSync",
    "unlinkSync",
    "rmdirSync",
  ],
  "node:fs/promises": [
    "readFile",
    "writeFile",
    "mkdir",
    "readdir",
    "stat",
    "lstat",
    "readlink",
    "realpath",
    "unlink",
    "rm",
    "rename",
    "copyFile",
    "appendFile",
    "watch",
    "constants",
  ],
  "fs/promises": [
    "readFile",
    "writeFile",
    "mkdir",
    "readdir",
    "stat",
    "lstat",
    "readlink",
    "realpath",
    "unlink",
    "rm",
    "rename",
    "copyFile",
    "appendFile",
    "watch",
    "constants",
  ],
  "node:process": [
    "env",
    "argv",
    "argv0",
    "stdout",
    "stderr",
    "stdin",
    "pid",
    "ppid",
    "platform",
    "version",
    "versions",
    "arch",
    "execPath",
    "execArgv",
    "cwd",
    "chdir",
    "exit",
    "nextTick",
    "hrtime",
    "on",
    "off",
    "once",
    "emit",
    "removeListener",
    "removeAllListeners",
    "uptime",
    "memoryUsage",
    "cpuUsage",
    "kill",
    "binding",
    "setUncaughtExceptionCaptureCallback",
    "hasUncaughtExceptionCaptureCallback",
  ],
  process: [
    "env",
    "argv",
    "argv0",
    "stdout",
    "stderr",
    "stdin",
    "pid",
    "ppid",
    "platform",
    "version",
    "versions",
    "arch",
    "execPath",
    "execArgv",
    "cwd",
    "chdir",
    "exit",
    "nextTick",
    "hrtime",
    "on",
    "off",
    "once",
    "emit",
    "removeListener",
    "removeAllListeners",
    "uptime",
    "memoryUsage",
    "cpuUsage",
    "kill",
    "binding",
    "setUncaughtExceptionCaptureCallback",
    "hasUncaughtExceptionCaptureCallback",
  ],
  "node:os": [
    "platform",
    "arch",
    "type",
    "release",
    "homedir",
    "tmpdir",
    "hostname",
    "cpus",
    "totalmem",
    "freemem",
    "EOL",
  ],
  os: [
    "platform",
    "arch",
    "type",
    "release",
    "homedir",
    "tmpdir",
    "hostname",
    "cpus",
    "totalmem",
    "freemem",
    "EOL",
  ],
  "node:util": [
    "promisify",
    "inspect",
    "format",
    "types",
    "isArray",
    "isRegExp",
    "isDate",
    "isError",
    "inherits",
    "deprecate",
    "stripVTControlCharacters",
    "styleText",
    "parseArgs",
    "getCallSite",
    "getSystemErrorName",
    "getSystemErrorMap",
    "debuglog",
    "callbackify",
    "TextEncoder",
    "TextDecoder",
  ],
  util: [
    "promisify",
    "inspect",
    "format",
    "types",
    "isArray",
    "isRegExp",
    "isDate",
    "isError",
    "inherits",
    "deprecate",
    "stripVTControlCharacters",
    "styleText",
    "parseArgs",
    "getCallSite",
    "getSystemErrorName",
    "getSystemErrorMap",
    "debuglog",
    "callbackify",
    "TextEncoder",
    "TextDecoder",
  ],
  "node:buffer": ["Buffer", "Blob", "kMaxLength", "transcode", "constants"],
  buffer: ["Buffer", "Blob", "kMaxLength", "transcode", "constants"],
  "node:stream": [
    "Readable",
    "Writable",
    "Transform",
    "Duplex",
    "PassThrough",
    "Stream",
    "EventEmitter",
    "pipeline",
    "finished",
  ],
  stream: [
    "Readable",
    "Writable",
    "Transform",
    "Duplex",
    "PassThrough",
    "Stream",
    "EventEmitter",
    "pipeline",
    "finished",
  ],
  "node:events": ["EventEmitter", "once", "on", "getEventListeners"],
  events: ["EventEmitter", "once", "on", "getEventListeners"],
  "node:crypto": [
    "createHash",
    "randomBytes",
    "getRandomValues",
    "createCipheriv",
    "createDecipheriv",
    "createHmac",
    "getCiphers",
    "constants",
  ],
  crypto: [
    "createHash",
    "randomBytes",
    "getRandomValues",
    "createCipheriv",
    "createDecipheriv",
    "createHmac",
    "getCiphers",
    "constants",
  ],
  "node:http": [
    "createServer",
    "request",
    "get",
    "STATUS_CODES",
    "IncomingMessage",
    "ServerResponse",
    "Server",
    "Agent",
    "globalAgent",
    "METHODS",
  ],
  http: [
    "createServer",
    "request",
    "get",
    "STATUS_CODES",
    "IncomingMessage",
    "ServerResponse",
    "Server",
    "Agent",
    "globalAgent",
    "METHODS",
  ],
  "node:https": [
    "createServer",
    "request",
    "get",
    "STATUS_CODES",
    "Agent",
    "Server",
    "globalAgent",
  ],
  https: [
    "createServer",
    "request",
    "get",
    "STATUS_CODES",
    "Agent",
    "Server",
    "globalAgent",
  ],
  "node:child_process": [
    "spawn",
    "exec",
    "execSync",
    "fork",
    "execFile",
    "execFileSync",
  ],
  child_process: [
    "spawn",
    "exec",
    "execSync",
    "fork",
    "execFile",
    "execFileSync",
  ],
  "node:tty": ["ReadStream", "WriteStream", "isatty"],
  tty: ["ReadStream", "WriteStream", "isatty"],
  "node:string_decoder": ["StringDecoder"],
  string_decoder: ["StringDecoder"],
  "node:dns": ["lookup", "resolve", "promises", "setServers", "getServers"],
  dns: ["lookup", "resolve", "promises", "setServers", "getServers"],
  "node:worker_threads": [
    "Worker",
    "isMainThread",
    "parentPort",
    "workerData",
    "threadId",
    "MessageChannel",
    "MessagePort",
  ],
  worker_threads: [
    "Worker",
    "isMainThread",
    "parentPort",
    "workerData",
    "threadId",
    "MessageChannel",
    "MessagePort",
  ],
  "node:zlib": [
    "gzip",
    "gunzip",
    "createGzip",
    "createGunzip",
    "createDeflate",
    "createInflate",
    "gzipSync",
    "gunzipSync",
    "deflateSync",
    "inflateSync",
    "constants",
  ],
  zlib: [
    "gzip",
    "gunzip",
    "createGzip",
    "createGunzip",
    "createDeflate",
    "createInflate",
    "gzipSync",
    "gunzipSync",
    "deflateSync",
    "inflateSync",
    "constants",
  ],
  "node:readline": ["cursorTo", "clearScreenDown", "createInterface"],
  readline: ["cursorTo", "clearScreenDown", "createInterface"],
};

function isBuiltin(id: string): boolean {
  return BUILTINS.has(id) || BUILTINS.has(id.replace(/^node:/, ""));
}

function getBuiltinContents(key: string): string {
  const exports = BUILTIN_NAMED_EXPORTS[key];
  const varName = "_";
  const baseId = key.replace(/^node:/, "");
  // default = main class so "class X extends (import('mod')).default" works (ws, chokidar)
  const defaultExport =
    baseId === "events"
      ? `${varName}?.EventEmitter ?? (typeof globalThis !== 'undefined' && globalThis.EventEmitter) ?? ${varName}`
      : baseId === "path"
        ? `${varName} ?? (typeof globalThis !== 'undefined' && globalThis.__wcPath)`
        : baseId === "process"
          ? `${varName} ?? (typeof globalThis !== 'undefined' && globalThis.process)`
          : varName;
  let body = `const ${varName} = globalThis.__wcBuiltins.get(${JSON.stringify(key)});\nexport default ${defaultExport};\n`;
  if (exports) {
    const globalFallbacks: Record<string, string> = {
      events: "EventEmitter",
      stream: "Readable,Writable,Stream,EventEmitter",
      path: "join,resolve,dirname,basename,extname,normalize",
      process:
        "env,argv,stdout,stderr,stdin,pid,platform,version,versions,cwd,exit,nextTick,hrtime,on,off,once,emit,removeAllListeners",
    };
    const fallbackNames = globalFallbacks[baseId]?.split(",") ?? [];
    for (const name of exports) {
      let fallback = "";
      if (fallbackNames.includes(name)) {
        if (baseId === "path") {
          fallback = ` ?? (typeof globalThis !== "undefined" && globalThis.__wcPath?.["${name}"])`;
        } else if (baseId === "process") {
          fallback = ` ?? (typeof globalThis !== "undefined" && (globalThis.process)?.[${JSON.stringify(name)}])`;
        } else {
          fallback = ` ?? (typeof globalThis !== 'undefined' && globalThis.${name})`;
        }
      }
      body += `export const ${name} = ${varName}?.${name}${fallback};\n`;
    }
  }
  return body;
}

/** Generate ESM content for a Node builtin (for /__wc__/builtin/<name> serve). */
export function getBuiltinEsmContent(name: string): string {
  const key = name.startsWith("node:") ? name : name;
  return getBuiltinContents(key);
}

export interface VfsPluginOptions {
  fallbackMode?: boolean;
  fileSource?: FileSource;
  /** Use import/browser conditions for resolution (ESM bundle for browser). Default: false (require/node). */
  useBrowserConditions?: boolean;
}

export function createVfsPlugin(
  vfs: VirtualFS,
  resolver: ModuleResolver,
  syncCache?: Map<string, string | Uint8Array>,
  options?: VfsPluginOptions,
): Plugin {
  const fallback = options?.fallbackMode ?? false;
  const fileSource = options?.fileSource;
  const useBrowserConditions = options?.useBrowserConditions ?? false;
  return {
    name: fallback ? "vfs-bridge" : "vfs",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        // Node.js package.json "imports" field (#-prefixed) — stub as empty module
        if (args.path.startsWith("#")) {
          return { path: args.path, namespace: "wc-stub" };
        }
        if (isBuiltin(args.path)) {
          return { path: args.path, namespace: "wc-builtin" };
        }
        if (GLOBAL_MODULES.has(args.path)) {
          return { path: args.path, namespace: "wc-global" };
        }
        if (STUB_PACKAGES.has(args.path)) {
          return { path: args.path, namespace: "wc-stub" };
        }
        const stubList = [...STUB_PACKAGES].sort((a, b) => b.length - a.length);
        for (const stub of stubList) {
          if (
            args.path === stub ||
            args.path.startsWith(stub + "/") ||
            args.path.includes("/node_modules/" + stub + "/") ||
            args.path.endsWith("/node_modules/" + stub)
          ) {
            return { path: stub, namespace: "wc-stub" };
          }
        }
        if (
          (args as { kind?: string }).kind === "entry-point" ||
          args.path.startsWith("/")
        ) {
          return { path: PathUtils.normalize(args.path), namespace: "wc-file" };
        }
        const importerRaw = args.importer || args.resolveDir || "/";
        const importerPath = importerRaw.includes(":")
          ? importerRaw.replace(/^[^:]+:\/*/, "/").replace(/^\/+/, "/") || "/"
          : importerRaw;
        const from = importerPath.endsWith("/")
          ? PathUtils.join(importerPath, "index.js")
          : importerPath;
        try {
          const resolved = useBrowserConditions
            ? await resolver.resolveForBrowser(args.path, from)
            : await resolver.resolve(args.path, from);
          for (const stub of stubList) {
            if (
              resolved.includes("/node_modules/" + stub + "/") ||
              resolved.endsWith("/node_modules/" + stub)
            ) {
              return { path: stub, namespace: "wc-stub" };
            }
          }
          return { path: resolved, namespace: "wc-file" };
        } catch (e) {
          // fallbackMode: mark unresolvable as external to prevent native resolver in Worker
          const ret = fallback ? { path: args.path, external: true } : null;
          return ret;
        }
      });

      // Load builtin: export default + named exports for `import { X } from 'node:Y'`
      build.onLoad({ filter: /.*/, namespace: "wc-builtin" }, (args) => {
        const key = args.path;
        return {
          contents: getBuiltinContents(key),
          loader: "js",
        };
      });

      // Load global module (e.g. esbuild -> esbuild-wasm from host)
      build.onLoad({ filter: /.*/, namespace: "wc-global" }, (args) => {
        if (args.path === "esbuild") {
          return {
            contents: `const m = globalThis.__wcEsbuild;
export default m;
export const build = m?.build;
export const buildSync = m?.buildSync;
export const transform = m?.transform;
export const transformSync = m?.transformSync;
export const formatMessages = m?.formatMessages;
export const formatMessagesSync = m?.formatMessagesSync;
export const analyzeMetafile = m?.analyzeMetafile;
export const analyzeMetafileSync = m?.analyzeMetafileSync;
export const initialize = m?.initialize;
export const version = m?.version;
export const stop = m?.stop;`,
            loader: "js",
          };
        }
        return {
          contents: `const m = globalThis.__wcEsbuild; export default m;`,
          loader: "js",
        };
      });

      // Load stub: use getStubContentsForBundle from stub-packages (single source of truth)
      build.onLoad({ filter: /.*/, namespace: "wc-stub" }, (args) => ({
        contents: getStubContentsForBundle(args.path),
        loader: "js",
      }));

      // Load file from VFS
      build.onLoad({ filter: /.*/, namespace: "wc-file" }, async (args) => {
        const path = args.path;
        try {
          // Try syncCache first — CJS loader preloads project files (vite.config.js etc.) before config build.
          const cached = syncCache?.get(path);
          if (cached != null) {
            const content =
              typeof cached === "string"
                ? cached
                : new TextDecoder().decode(cached);
            if (content) {
              const ext = PathUtils.extname(path);
              const loader =
                ext === ".ts" || ext === ".tsx"
                  ? "ts"
                  : ext === ".json"
                    ? "json"
                    : "js";
              return { contents: content, loader };
            }
          }
          const reader = fileSource ?? vfs;
          const raw = await reader.readFile(path, "utf8");
          const content =
            typeof raw === "string"
              ? raw
              : new TextDecoder().decode(raw as Uint8Array);
          syncCache?.set(path, content);
          const ext = PathUtils.extname(path);
          const loader =
            ext === ".ts" || ext === ".tsx"
              ? "ts"
              : ext === ".json"
                ? "json"
                : "js";
          return { contents: content, loader };
        } catch (e) {
          throw e;
        }
      });

      // fallbackMode: also load files in the default 'file' namespace from VFS.
      // This catches files resolved by other plugins (e.g. config bundler plugins) that
      // return paths in the default namespace — the Worker can't read them natively.
      if (fallback) {
        build.onLoad({ filter: /.*/, namespace: "file" }, async (args) => {
          const path = args.path;
          try {
            const reader = fileSource ?? vfs;
            const raw = await reader.readFile(path, "utf8");
            const content =
              typeof raw === "string"
                ? raw
                : new TextDecoder().decode(raw as Uint8Array);
            syncCache?.set(path, content);
            const ext = PathUtils.extname(path);
            const loader =
              ext === ".ts" || ext === ".tsx"
                ? "ts"
                : ext === ".json"
                  ? "json"
                  : "js";
            return { contents: content, loader };
          } catch (e) {
            return null;
          }
        });
      }
    },
  };
}
