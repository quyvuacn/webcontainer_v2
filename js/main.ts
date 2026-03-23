import { RamVfs } from "./vfs_ram";
import { initWasmVfs } from "./vfs_wasm";
import { preloadEsbuildWasm } from "../node/transform/esm-to-cjs";
import {
  initOpfsBridge,
  opfsWrite,
  opfsDelete,
  opfsListAll,
  createBroadcastChannel,
} from "./opfs_bridge";
import { VFS_PREFIX } from "./config";
import { createCdnVfsProxy } from "./cdn/vfs_proxy";
import { lazyFetchNodeModulesFile } from "./cdn/lazy_node_modules";
import { handleSyncFsRequest } from "./lib/sync_vfs_channel";
import { getBuiltinEsmContent } from "../node/transform/esbuild-vfs-plugin";
import { rewriteBareSpecifiersInModule } from "../node/transform/bare-specifier-rewrite";
import { createVirtualFSAdapter } from "../node/vfs/core/adapter";

let vfs: {
  read: (p: string) => Uint8Array | null;
  write: (p: string, c: Uint8Array | string) => void;
  exists: (p: string) => boolean;
  acquireLock: (p: string) => number;
  releaseLock: (id: number) => void;
  delete?: (p: string) => boolean;
  invalidate?: (p: string) => void;
  preload?: (p: string, c: Uint8Array) => void;
} | null = null;
/** Cache of rewritten JS files (bare imports → /__wc__/... URLs) for SW serving. */
const vfsRewriteCache = new Map<string, Uint8Array>();
const portHandlers = new Map<number, (req: unknown, res: unknown) => void>();
const portOwners = new Map<number, string>();
const portWorkers = new Map<
  number,
  { tcpWorker: Worker; handlerWorker: Worker }
>();
// SAB per port — persists across SW restarts so reRegisterPorts can resend buffer
const portSabs = new Map<number, SharedArrayBuffer>();
// MessagePort returned to main thread from sendPortToSw — closed before re-creating on SW restart
const portMainPorts = new Map<number, MessagePort>();
let controllerchangeAttached = false;
const SAB_SIZE = 4 * 1024 * 1024;

function acquireTabLock(): Promise<void> {
  return new Promise((resolve, reject) => {
    navigator.locks.request(
      "browser_node_project",
      { mode: "exclusive", ifAvailable: true },
      (lock) => {
        if (!lock) {
          reject(new Error("Project already open in another tab"));
          return;
        }
        resolve();
        return new Promise(() => {});
      },
    );
  });
}

type VfsPortMsg = {
  op: string;
  id?: string;
  path?: string;
  bytes?: number[];
  prefix?: string;
  lockId?: number;
  recursive?: boolean;
};

function handleVfsPort(port: MessagePort) {
  const v = vfs as {
    read: (p: string) => Uint8Array | null;
    write: (p: string, c: Uint8Array) => void;
    acquireLock?: (p: string) => number;
    releaseLock?: (id: number) => void;
    delete?: (p: string) => boolean;
    exists?: (p: string) => boolean;
    readdir?: (p: string) => string[] | Promise<string[]>;
    stat?: (p: string) => {
      isFile: () => boolean;
      isDirectory: () => boolean;
      size?: number;
      mtime?: Date;
    } | null;
    mkdir?: (p: string) => void;
  } | null;
  port.onmessage = async ({ data }: MessageEvent<VfsPortMsg>) => {
    const path = (data.path ?? "").replace(/^\/+/, "");
    switch (data.op) {
      case "read": {
        let bytes = v!.read(path);
        if (!bytes && path.includes("node_modules/")) {
          bytes = await lazyFetchNodeModulesFile(
            path,
            v!.read.bind(v!),
            v!.write.bind(v!),
          );
        }
        port.postMessage({ id: data.id, bytes: bytes ? [...bytes] : null });
        break;
      }
      case "write": {
        v!.write(path, new Uint8Array(data.bytes || []));
        port.postMessage({ id: data.id });
        break;
      }
      case "acquire_lock": {
        const lockId = v!.acquireLock?.(data.prefix ?? "") ?? 0;
        port.postMessage({ id: data.id, lockId });
        break;
      }
      case "release_lock": {
        v!.releaseLock?.(data.lockId!);
        port.postMessage({ id: data.id });
        break;
      }
      case "delete": {
        const ok = v!.delete?.(path) ?? false;
        port.postMessage({ id: data.id, ok });
        break;
      }
      case "exists": {
        let ok = v!.exists?.(path) ?? v!.read(path) !== null;
        if (!ok && path.includes("node_modules/")) {
          // Fetch and cache so subsequent reads work immediately
          const fetched = await lazyFetchNodeModulesFile(
            path,
            v!.read.bind(v!),
            v!.write.bind(v!),
          );
          ok = fetched !== null;
        }
        port.postMessage({ id: data.id, ok });
        break;
      }
      case "readdir": {
        const names = v!.readdir ? await Promise.resolve(v!.readdir(path)) : [];
        port.postMessage({ id: data.id, names });
        break;
      }
      case "stat": {
        const st = v!.stat?.(path);
        port.postMessage({
          id: data.id,
          stat: st
            ? {
                isFile: st.isFile(),
                isDirectory: st.isDirectory(),
                size: st.size ?? 0,
                mtime: (st.mtime as Date)?.getTime?.() ?? 0,
              }
            : null,
        });
        break;
      }
      case "mkdir": {
        v!.mkdir?.(path);
        port.postMessage({ id: data.id });
        break;
      }
      case "rmdir": {
        // Recursive delete via raw VFS delete if rmdir not available
        if (v!.readdir) {
          const recursive = data.recursive ?? false;
          if (recursive) {
            const deleteDir = async (dir: string): Promise<void> => {
              let names: string[];
              try {
                names = await Promise.resolve(v!.readdir!(dir));
              } catch {
                return;
              }
              for (const name of names) {
                if (name === "." || name === "..") continue;
                const child = dir + "/" + name;
                const st = v!.stat?.(child);
                if (st?.isDirectory()) await deleteDir(child);
                else {
                  const ok = v!.delete?.(child);
                  if (!ok) console.warn(`[rmdir] failed to delete ${child}`);
                }
              }
              const dirOk = v!.delete?.(dir);
              if (!dirOk) console.warn(`[rmdir] failed to delete dir ${dir}`);
            };
            await deleteDir(path);
          } else {
            v!.delete?.(path);
          }
        } else {
          v!.delete?.(path);
        }
        port.postMessage({ id: data.id });
        break;
      }
    }
  };
}

export function registerWorkerVfsPort(port: MessagePort) {
  if (vfs) handleVfsPort(port);
}

/** Register a SAB sync-channel for a worker. The worker sends { type:'sync_vfs' }
 *  on syncPort when it needs a blocking read/exists, then Atomics.waits on the SAB. */
export function registerSyncVfsChannel(
  sab: SharedArrayBuffer,
  syncPort: MessagePort,
) {
  if (!vfs) return;
  const v = vfs;
  const handleRead = async (path: string): Promise<Uint8Array | null> => {
    const stripped = path.startsWith("/") ? path.slice(1) : path;
    let bytes = v.read(stripped);
    if (!bytes && stripped.includes("node_modules/")) {
      bytes = await lazyFetchNodeModulesFile(
        stripped,
        v.read.bind(v),
        v.write.bind(v),
      );
    }
    return bytes ?? null;
  };
  const handleExists = async (path: string): Promise<boolean> => {
    const stripped = path.startsWith("/") ? path.slice(1) : path;
    if (v.exists(stripped)) return true;
    if (stripped.includes("node_modules/")) {
      const fetched = await lazyFetchNodeModulesFile(
        stripped,
        v.read.bind(v),
        v.write.bind(v),
      );
      return fetched !== null;
    }
    return false;
  };
  syncPort.onmessage = () => handleSyncFsRequest(sab, handleRead, handleExists);
}

export function getVfsRead(path: string) {
  const p = path.startsWith("/") ? path.slice(1) : path;
  return vfs ? vfs.read(p) : null;
}

function reRegisterPorts() {
  for (const [port, swSab] of portSabs.entries()) {
    sendPortToSw(port, swSab);
  }
}

function unregisterPortFromSw(port: number) {
  const post = (sw: ServiceWorker | null) =>
    sw?.postMessage({ type: "unregister_port", port });
  const ctrl = navigator.serviceWorker.controller;
  ctrl
    ? post(ctrl)
    : navigator.serviceWorker
        .getRegistration()
        .then((r) => post(r?.active ?? null));
}

export function teardownVirtualPort(port: number, clientId: string): boolean {
  if (portOwners.get(port) !== clientId) return false;
  const workers = portWorkers.get(port);
  if (workers) {
    workers.tcpWorker.terminate();
    workers.handlerWorker.terminate();
    portWorkers.delete(port);
  }
  portMainPorts.get(port)?.close();
  portMainPorts.delete(port);
  portSabs.delete(port);
  portHandlers.delete(port);
  portOwners.delete(port);
  unregisterPortFromSw(port);
  return true;
}

async function processVirtualTcpRequest(
  port: number,
  requestBytes: Uint8Array,
): Promise<Uint8Array> {
  const swSab = portSabs.get(port);
  if (!swSab) throw new Error("No SAB for port " + port);
  const DATA_OFF = 12;
  const maxPayload = swSab.byteLength - DATA_OFF;
  if (requestBytes.length > maxPayload) {
    throw new Error(
      `Request too large for SAB: ${requestBytes.length} > ${maxPayload}`,
    );
  }
  const ctrl = new Int32Array(swSab);
  const data = new Uint8Array(swSab);
  data.set(requestBytes, DATA_OFF);
  Atomics.store(ctrl, 1, requestBytes.length);
  Atomics.store(ctrl, 0, 1);
  Atomics.notify(ctrl, 0);
  const result = Atomics.waitAsync(ctrl, 0, 1);
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("processVirtualTcpRequest timeout (15s)")),
      15000,
    ),
  );
  await Promise.race([result.value ?? Promise.resolve(), timeout]);
  const respLen = Atomics.load(ctrl, 2);
  if (DATA_OFF + requestBytes.length + respLen > swSab.byteLength) {
    throw new Error(`Response overflows SAB buffer: respLen=${respLen}`);
  }
  const respBytes = data.slice(
    DATA_OFF + requestBytes.length,
    DATA_OFF + requestBytes.length + respLen,
  );
  Atomics.store(ctrl, 0, 0);
  return respBytes;
}

function sendPortToSw(port: number, swSab: SharedArrayBuffer) {
  // Close previous mainPort for this virtual port (SW restart scenario)
  portMainPorts.get(port)?.close();
  const { port1: mainPort, port2: swPort } = new MessageChannel();
  portMainPorts.set(port, mainPort);
  mainPort.onmessage = async ({
    data: msg,
  }: MessageEvent<{ requestBytes?: number[]; responsePort?: MessagePort }>) => {
    if (!msg.requestBytes || !msg.responsePort) return;
    try {
      const reqBytes = new Uint8Array(msg.requestBytes);
      const respBytes = await processVirtualTcpRequest(port, reqBytes);
      msg.responsePort.postMessage({ responseBytes: [...respBytes] });
    } catch (e) {
      try {
        msg.responsePort.postMessage({
          error: (e as Error)?.message ?? String(e),
        });
      } catch {}
    }
    try {
      msg.responsePort.close();
    } catch {}
  };
  const { port1: ackIn, port2: ackOut } = new MessageChannel();
  ackIn.onmessage = () => {
    ackIn.close?.();
    window.dispatchEvent(
      new CustomEvent("port-registered", { detail: { port } }),
    );
  };
  const ctrl = navigator.serviceWorker.controller;
  const post = (sw: ServiceWorker | null) =>
    sw?.postMessage(
      { type: "register_port", port, mainPort: swPort, ackPort: ackOut },
      [swPort, ackOut],
    );
  ctrl
    ? post(ctrl)
    : navigator.serviceWorker
        .getRegistration()
        .then((r) => post(r?.active ?? null));
}

export function setupVirtualPort(
  port: number,
  handler: (req: unknown, res: unknown) => void,
  clientId?: string,
): { ok: boolean; error?: string } {
  const owner = portOwners.get(port);
  if (owner !== undefined && owner !== clientId) {
    return {
      ok: false,
      error: `EADDRINUSE: address already in use :::${port}`,
    };
  }
  if (portSabs.has(port)) {
    portHandlers.set(port, handler);
    sendPortToSw(port, portSabs.get(port)!);
    if (clientId) portOwners.set(port, clientId);
    return { ok: true };
  }

  if (clientId) portOwners.set(port, clientId);
  portHandlers.set(port, handler);

  const swSab = new SharedArrayBuffer(SAB_SIZE);
  const handSab = new SharedArrayBuffer(SAB_SIZE);
  portSabs.set(port, swSab);

  const tcpWorker = new Worker(new URL("./tcp_worker.ts", import.meta.url), {
    type: "module",
  });
  tcpWorker.postMessage({ sw_sab: swSab, hand_sab: handSab });

  const { port1, port2 } = new MessageChannel();
  const handlerWorker = new Worker(
    new URL("./handler_worker.ts", import.meta.url),
    { type: "module" },
  );
  handlerWorker.postMessage({ hand_sab: handSab, mainPort: port2, port }, [
    port2,
  ]);
  handlerWorker.postMessage({ type: "run" });
  portWorkers.set(port, { tcpWorker, handlerWorker });

  port1.onmessage = ({
    data: msg,
  }: MessageEvent<{ type: string; port?: number; request?: unknown }>) => {
    if (msg.type === "handle_request") {
      const cb = portHandlers.get(msg.port ?? port);
      const req = msg.request as {
        method: string;
        url: string;
        headers: Record<string, string>;
        path: string;
      };
      try {
        const u = new URL(req.url, "http://localhost");
        req.path = u.pathname.replace(/^\/__port__\/\d+/, "") || "/";
      } catch {}
      const res = {
        statusCode: 200,
        _headers: {} as Record<string, string>,
        _done: false,
        setHeader(k: string, v: string) {
          this._headers[k] = v;
        },
        end(body: string | Uint8Array = "") {
          if (this._done) return;
          this._done = true;
          port1.postMessage({
            type: "handler_response",
            response: {
              status: this.statusCode,
              headers: this._headers,
              body:
                typeof body === "string"
                  ? body
                  : new TextDecoder().decode(body),
            },
          });
        },
      };
      try {
        if (cb) cb(req, res);
        else res.end("No handler");
      } catch (e) {
        res.statusCode = 500;
        res.end((e as Error)?.message ?? String(e));
      }
    }
  };

  if (navigator.serviceWorker.controller) sendPortToSw(port, swSab);
  else navigator.serviceWorker.ready.then(() => sendPortToSw(port, swSab));

  if (!controllerchangeAttached) {
    controllerchangeAttached = true;
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      reRegisterPorts,
    );
  }
  return { ok: true };
}

export function createServer(handler: (req: unknown, res: unknown) => void) {
  return {
    listen(port: number) {
      setupVirtualPort(port, (req, res) => {
        const url = new URL((req as { url: string }).url);
        (req as { path: string }).path =
          url.pathname.replace(/^\/__port__\/\d+/, "") || "/";
        handler(req, res);
      });
    },
  };
}

async function bootstrap() {
  const reg = await navigator.serviceWorker.register("/sw.js", {
    updateViaCache: "none",
  });
  await navigator.serviceWorker.ready;
  if (reg.waiting) {
    reg.waiting.postMessage({ type: "SKIP_WAITING" });
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => location.reload(),
      { once: true },
    );
  }
  if (!crossOriginIsolated) {
    if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    location.reload();
    return;
  }

  await acquireTabLock();

  initOpfsBridge(new URL("./opfs_worker.ts", import.meta.url));

  try {
    const wasm = await initWasmVfs();
    let ok = false;
    try {
      wasm?.preload?.("vfscheck", new Uint8Array([1]));
    } catch (e) {
      console.warn(
        "[bootstrap] WASM preload failed:",
        (e as Error)?.message ?? e,
      );
      throw e;
    }
    try {
      ok = wasm?.read?.("vfscheck")?.length === 1;
    } catch (e) {
      console.warn("[bootstrap] WASM read failed:", (e as Error)?.message ?? e);
      throw e;
    }
    try {
      if (wasm?.delete) wasm.delete("vfscheck");
    } catch (e) {
      console.warn(
        "[bootstrap] WASM delete failed:",
        (e as Error)?.message ?? e,
      );
      throw e;
    }
    vfs = ok
      ? wasm
      : new RamVfs(
          (p, b) => opfsWrite(p, b).then(() => {}),
          (p) => opfsDelete(p).then(() => {}),
        );
    if (!ok)
      console.warn("[bootstrap] WASM VFS failed self-check, using JS RamVfs");
  } catch (e) {
    console.warn(
      "[bootstrap] WASM VFS fallback to JS:",
      (e as Error)?.message ?? e,
    );
    vfs = new RamVfs(
      (p, b) => opfsWrite(p, b).then(() => {}),
      (p) => opfsDelete(p).then(() => {}),
    );
  }
  let results: { path: string; content: Uint8Array }[] = [];
  try {
    results = await Promise.race([
      opfsListAll(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("OPFS timeout")), 3000),
      ),
    ]);
  } catch (e) {
    console.warn("[bootstrap] opfsListAll:", (e as Error)?.message ?? e);
    window.dispatchEvent(
      new CustomEvent("bootstrap-warning", {
        detail: {
          code: "OPFS_TIMEOUT",
          message: "OPFS load timed out — persisted files may not be restored",
        },
      }),
    );
  }
  for (const { path, content } of results) {
    vfs!.preload?.(path, content);
  }

  const skipInvalidate = new Map<string, number>();
  if (vfs && typeof vfs.write === "function") {
    const orig = vfs.write.bind(vfs);
    vfs.write = (p: string, c: Uint8Array | string) => {
      skipInvalidate.set(p, (skipInvalidate.get(p) || 0) + 1);
      orig(p, c);
    };
  }
  createBroadcastChannel((path: string) => {
    const n = skipInvalidate.get(path) || 0;
    if (n > 0) {
      skipInvalidate.set(path, n - 1);
      if (n === 1) skipInvalidate.delete(path);
      return;
    }
    vfs?.invalidate?.(path);
  });

  const sw = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<ServiceWorker | null>((_, reject) =>
      setTimeout(() => reject(new Error("Service Worker timeout")), 5000),
    ),
  ]).catch((e) => {
    console.warn("[bootstrap] SW ready:", (e as Error)?.message ?? e);
    return null;
  });
  if (sw?.active) {
    sw.active.postMessage({ type: "VFS_READY" });
  } else {
    // SW timed out during bootstrap — send VFS_READY once it becomes active
    navigator.serviceWorker.ready
      .then((reg) => reg.active?.postMessage({ type: "VFS_READY" }))
      .catch(() => {});
  }

  const cdnProxy = createCdnVfsProxy(getVfsRead, (p, b) => vfs?.write(p, b));
  navigator.serviceWorker.addEventListener(
    "message",
    async ({
      data,
    }: MessageEvent<{
      type: string;
      path?: string;
      requestId?: string;
      bytes?: number[] | null;
    }>) => {
      if (data.type === "vfs_request") {
        const reqPath = data.path!;
        let bytes: Uint8Array | null = null;

        // Serve Node.js builtin ESM stubs (e.g. "builtin/path", "builtin/fs")
        if (reqPath.startsWith("builtin/")) {
          const builtinName = reqPath.slice("builtin/".length);
          try {
            const stub = getBuiltinEsmContent(builtinName);
            bytes = new TextEncoder().encode(stub);
          } catch {
            bytes = null;
          }
        } else {
          // Check rewrite cache first (for already-rewritten JS files)
          bytes = vfsRewriteCache.get(reqPath) ?? null;
          if (!bytes) {
            bytes = getVfsRead(reqPath);
            if (!bytes) bytes = await cdnProxy.read(reqPath);
            // Lazily rewrite bare specifiers in JS files so transitive imports
            // (e.g. node_modules/vite/dist/node/index.js) work in the browser.
            if (
              bytes &&
              vfs &&
              /\.(m?js|cjs)$/.test(reqPath) &&
              !reqPath.includes(".timestamp-")
            ) {
              try {
                const src = new TextDecoder().decode(bytes);
                const vfsAdapter = createVirtualFSAdapter(vfs);
                const fromFile = "/" + reqPath.replace(/^\//, "");
                const rewritten = await rewriteBareSpecifiersInModule(
                  src,
                  fromFile,
                  vfsAdapter,
                );
                if (rewritten !== src) {
                  bytes = new TextEncoder().encode(rewritten);
                }
                // Cache result (rewritten or original) to avoid re-processing
                vfsRewriteCache.set(reqPath, bytes!);
              } catch {
                // If rewriting fails, serve original bytes
              }
            }
          }
        }

        navigator.serviceWorker.controller?.postMessage({
          type: "vfs_response",
          requestId: data.requestId,
          bytes: bytes ? [...bytes] : null,
        });
      }
      // virtual_tcp_request removed: HTTP requests now flow SW → TCP Worker → Handler Worker via SAB
    },
  );
  (
    globalThis as { __vfsRead?: (path: string) => Uint8Array | null }
  ).__vfsRead = getVfsRead;
  (
    globalThis as { __vfsWrite?: (path: string, bytes: Uint8Array) => void }
  ).__vfsWrite = (path, bytes) => vfs?.write(path, bytes);

  try {
    await preloadEsbuildWasm();
  } catch (e) {
    console.warn(
      "[bootstrap] esbuild.wasm preload failed:",
      (e as Error)?.message ?? e,
    );
  }

  return {
    vfs,
    VFS_PREFIX,
    createServer,
    setupVirtualPort,
    registerWorkerVfsPort,
  };
}

export { bootstrap, RamVfs };
