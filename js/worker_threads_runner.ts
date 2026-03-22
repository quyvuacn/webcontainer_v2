/**
 * Web Worker entrypoint for:
 * - worker_threads.Worker(filename)  — init: { vfsPort, filename, workerData, cwd, env, threadId }
 * - shell `node` command (Ctrl+C kill) — init: { vfsPort, tcpRegPort?, args, cwd, env }
 *
 * Messages to main: { type: 'message'|'error'|'exit'|'stdout'|'stderr', data }
 * tcpRegPort: when Node http.createServer().listen(port) is called, we register the port with Main.
 */

import { ProcessExitError } from "../node/polyfills/process";
import { Buffer } from "buffer";
import { addActiveHandle } from "../node/polyfills/active-handles";
import { IncomingMessage, ServerResponse } from "../node/polyfills/http";
import type { Stats } from "../node/vfs/core/adapter";
import { preloadEsbuildWasm } from "../node/transform/esm-to-cjs";
import { runNode } from "../node/cli";
import { PathUtils } from "../node/vfs/core/path";
import { syncRead, syncExists } from "./lib/sync_vfs_channel";

let parentPortListeners: ((data: unknown) => void)[] = [];
let workerTerminal: {
  write: (t: string) => void;
  writeError?: (t: string) => void;
} | null = null;

self.addEventListener("unhandledrejection", (e) => {
  if (workerTerminal && !(e.reason instanceof ProcessExitError)) {
    e.preventDefault();
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
    (workerTerminal.writeError ?? workerTerminal.write)(msg + "\n");
    self.postMessage({ type: "exit", data: 1 });
  }
});

const parentPort = {
  postMessage(data: unknown, _transfer?: Transferable[]) {
    self.postMessage({ type: "message", data });
  },
  on(_event: string, fn: (data: unknown) => void) {
    if (_event === "message") parentPortListeners.push(fn);
  },
  once(_event: string, fn: (data: unknown) => void) {
    if (_event === "message") {
      const wrapper = (data: unknown) => {
        fn(data);
        parentPortListeners = parentPortListeners.filter((l) => l !== wrapper);
      };
      parentPortListeners.push(wrapper);
    }
  },
  off(_event: string, fn: (data: unknown) => void) {
    if (_event === "message")
      parentPortListeners = parentPortListeners.filter((l) => l !== fn);
  },
  removeListener(e: string, fn: (data: unknown) => void) {
    this.off(e, fn);
  },
  addListener(e: string, fn: (data: unknown) => void) {
    this.on(e, fn);
  },
};

function createPortVfs(
  port: MessagePort,
  syncFsSab?: SharedArrayBuffer,
  syncFsPort?: MessagePort,
) {
  let id = 0;
  const pending = new Map<string, { resolve: (v: unknown) => void }>();
  type PortRes = {
    id?: string;
    bytes?: number[] | null;
    ok?: boolean;
    names?: string[];
    stat?: {
      isFile: boolean;
      isDirectory: boolean;
      size: number;
      mtime: number;
    } | null;
  };
  port.onmessage = ({ data }: MessageEvent<PortRes>) => {
    if (data.id && pending.has(data.id)) {
      const p = pending.get(data.id)!;
      pending.delete(data.id);
      p.resolve(data);
    }
  };
  const send = (op: string, extra: Record<string, unknown> = {}) =>
    new Promise<PortRes>((resolve) => {
      const rid = `${++id}`;
      pending.set(rid, { resolve: resolve as (v: unknown) => void });
      port.postMessage({ op, id: rid, ...extra });
    });
  const norm = (p: string) => (p.startsWith("/") ? p.slice(1) : p);

  return {
    async readFile(
      path: string,
      encoding?: string,
    ): Promise<string | Uint8Array> {
      const res = await send("read", { path: norm(path) });

      if (!res.bytes)
        throw Object.assign(new Error(`ENOENT: '${path}'`), { code: "ENOENT" });
      const arr = new Uint8Array(res.bytes);

      return encoding === "utf8" || encoding === "utf-8"
        ? new TextDecoder().decode(arr)
        : arr;
    },
    async writeFile(path: string, content: string | Uint8Array): Promise<void> {
      const bytes =
        typeof content === "string"
          ? new TextEncoder().encode(content)
          : new Uint8Array(content);
      await send("write", { path: norm(path), bytes: [...bytes] });
    },
    async mkdir(path: string, _opts?: { recursive?: boolean }): Promise<void> {
      await send("mkdir", { path: norm(path) });
    },
    async unlink(path: string): Promise<void> {
      await send("delete", { path: norm(path) });
    },
    async rmdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
      await send("rmdir", {
        path: norm(path),
        recursive: opts?.recursive ?? false,
      });
    },
    async exists(path: string): Promise<boolean> {
      const res = await send("exists", { path: norm(path) });
      return res.ok ?? false;
    },
    async stat(path: string): Promise<Stats> {
      const res = await send("stat", { path: norm(path) });
      const s = res.stat;
      if (!s)
        throw Object.assign(new Error(`ENOENT: '${path}'`), { code: "ENOENT" });
      const t = new Date(s.mtime ?? 0);
      return {
        ino: 0,
        size: s.size ?? 0,
        mode: 0o644,
        atime: t,
        mtime: t,
        ctime: t,
        isFile: () => s.isFile,
        isDirectory: () => s.isDirectory,
        isSymbolicLink: () => false,
      };
    },
    async readdir(path: string): Promise<string[]> {
      const res = await send("readdir", { path: norm(path) });
      return res.names ?? [];
    },

    // Synchronous ops — backed by SAB channel when available
    ...(syncFsSab && syncFsPort
      ? {
          readFileSync(path: string, encoding?: string): string | Uint8Array {
            const bytes = syncRead(syncFsSab, syncFsPort, norm(path));
            if (!bytes)
              throw Object.assign(new Error(`ENOENT: '${path}'`), {
                code: "ENOENT",
              });
            return encoding === "utf8" || encoding === "utf-8"
              ? new TextDecoder().decode(bytes)
              : bytes;
          },
          existsSync(path: string): boolean {
            return syncExists(syncFsSab, syncFsPort, norm(path));
          },
        }
      : {}),
  };
}

const pendingSpawns = new Map<
  number,
  {
    resolve: (code: number) => void;
    proc?: {
      stdout: { emit: (e: string, d: unknown) => void };
      stderr: { emit: (e: string, d: unknown) => void };
    };
  }
>();
let spawnRequestId = 0;

function setupSpawnHook() {
  const g = globalThis as Record<string, unknown>;
  g.__runNode = (
    args: string[],
    opts?: {
      cwd?: string;
      env?: Record<string, string>;
      __proc?: {
        stdout: { emit: (e: string, d: unknown) => void };
        stderr: { emit: (e: string, d: unknown) => void };
      };
    },
  ) => {
    const rid = ++spawnRequestId;
    return new Promise<number>((resolve) => {
      pendingSpawns.set(rid, { resolve, proc: opts?.__proc });
      self.postMessage({
        type: "spawn",
        requestId: rid,
        args,
        cwd: opts?.cwd,
        env: opts?.env,
      });
    });
  };
}

function setupTcpRegHook(tcpRegPort: MessagePort) {
  const clientId = crypto.randomUUID();
  const registeredPorts = new Set<number>();
  const g = globalThis as Record<string, unknown>;
  g.__setupVirtualPort = (
    port: number,
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ): Promise<() => void> => {
    const release = addActiveHandle();
    const { port1: ackIn, port2: ackOut } = new MessageChannel();
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = ({
      data,
    }: MessageEvent<{
      type: string;
      requestId?: string;
      method?: string;
      url?: string;
      headers?: [string, string][];
      body?: number[];
    }>) => {
      if (data.type !== "virtual_tcp_request" || !data.requestId) return;
      const req = new IncomingMessage({
        method: data.method ?? "GET",
        url: data.url ?? "/",
        headers: data.headers ? Object.fromEntries(data.headers) : {},
      });
      const res = new ServerResponse();
      const origEnd = res.end.bind(res);
      res.end = function (body?: string | Uint8Array) {
        origEnd(body);
        const h = Object.entries(res.getHeaders()) as [string, string][];
        const writtenChunks: Uint8Array[] =
          (res as ServerResponse & { _writeBuffer?: Uint8Array[] })
            ._writeBuffer ?? [];
        const finalBytes =
          body instanceof Uint8Array
            ? body
            : body
              ? new TextEncoder().encode(body)
              : new Uint8Array(0);
        const allChunks = [...writtenChunks, finalBytes];
        const totalLen = allChunks.reduce((s, c) => s + c.length, 0);
        const combined = new Uint8Array(totalLen);
        let off = 0;
        for (const c of allChunks) {
          combined.set(c, off);
          off += c.length;
        }
        port1.postMessage({
          type: "virtual_tcp_response",
          requestId: data.requestId,
          status: (res as { statusCode?: number }).statusCode ?? 200,
          headers: h,
          body: [...combined],
        });
      } as typeof res.end;
      queueMicrotask(() => {
        if (data.body?.length) {
          req.emit("data", new Uint8Array(data.body));
        }
        req.emit("end");
      });
      try {
        handler(req, res);
      } catch (e) {
        (res as { statusCode?: number }).statusCode = 500;
        res.end((e as Error)?.message ?? String(e));
      }
    };
    tcpRegPort.postMessage(
      {
        type: "register_virtual_port",
        port,
        requestPort: port2,
        ackPort: ackOut,
        clientId,
      },
      [port2, ackOut],
    );
    return new Promise<() => void>((resolve, reject) => {
      ackIn.onmessage = ({
        data,
      }: MessageEvent<{ ok?: boolean; error?: string }>) => {
        ackIn.close();
        if (data.error) {
          release();
          reject(Object.assign(new Error(data.error), { code: "EADDRINUSE" }));
        } else {
          registeredPorts.add(port);
          resolve(() => {
            registeredPorts.delete(port);
            release();
          });
        }
      };
    });
  };
  (globalThis as { __wcHasTcpReg?: boolean }).__wcHasTcpReg = true;
  g.__unregisterVirtualPorts = () => {
    for (const port of registeredPorts) {
      tcpRegPort.postMessage({
        type: "unregister_virtual_port",
        port,
        clientId,
      });
    }
    registeredPorts.clear();
  };
}

async function runInWorker(
  vfsPort: MessagePort,
  terminal: { write: (t: string) => void; writeError: (t: string) => void },
  args: string[],
  cwd: string,
  env: Record<string, string>,
  wasmBytes?: ArrayBuffer,
  tcpRegPort?: MessagePort,
  syncFsSab?: SharedArrayBuffer,
  syncFsPort?: MessagePort,
) {
  const g = globalThis as Record<string, unknown>;
  if (tcpRegPort) setupTcpRegHook(tcpRegPort);
  setupSpawnHook();
  if (!g.__wcEsbuildWasmModule) {
    if (wasmBytes) {
      g.__wcEsbuildWasmModule = await WebAssembly.compile(wasmBytes);
    } else {
      await preloadEsbuildWasm();
    }
  }
  const exitCode = await runNode(
    args,
    createPortVfs(vfsPort, syncFsSab, syncFsPort),
    terminal,
    { cwd, env },
  );
  (
    globalThis as { __unregisterVirtualPorts?: () => void }
  ).__unregisterVirtualPorts?.();
  self.postMessage({ type: "exit", data: exitCode });
}

self.onmessage = async ({
  data,
}: MessageEvent<{
  type: string;
  vfsPort?: MessagePort;
  filename?: string;
  args?: string[];
  workerData?: unknown;
  cwd?: string;
  env?: Record<string, string>;
  threadId?: number;
  requestId?: number;
  exitCode?: number;
}>) => {
  if (data.type === "spawn_response") {
    const pending = pendingSpawns.get(data.requestId ?? 0);
    if (pending) {
      pendingSpawns.delete(data.requestId ?? 0);
      pending.resolve((data.exitCode as number) ?? 1);
    }
    return;
  }
  if (data.type === "spawn_stdout") {
    const pending = pendingSpawns.get(data.requestId ?? 0);
    if (pending?.proc)
      pending.proc.stdout.emit(
        "data",
        Buffer.from((data as { data?: string }).data ?? "", "utf8"),
      );
    return;
  }
  if (data.type === "spawn_stderr") {
    const pending = pendingSpawns.get(data.requestId ?? 0);
    if (pending?.proc)
      pending.proc.stderr.emit(
        "data",
        Buffer.from((data as { data?: string }).data ?? "", "utf8"),
      );
    return;
  }
  if (data.type === "init") {
    const init = data as {
      vfsPort?: MessagePort;
      filename?: string;
      args?: string[];
      workerData?: unknown;
      cwd?: string;
      env?: Record<string, string>;
      threadId?: number;
      wasmBytes?: ArrayBuffer;
      tcpRegPort?: MessagePort;
      syncFsSab?: SharedArrayBuffer;
      syncFsPort?: MessagePort;
      vfsPrefix?: string;
    };
    const {
      vfsPort,
      filename,
      args,
      workerData,
      cwd = "/",
      env = {},
      threadId = 0,
      wasmBytes,
      tcpRegPort,
      syncFsSab,
      syncFsPort,
      vfsPrefix,
    } = init;
    if (vfsPrefix)
      (globalThis as Record<string, unknown>).__wcVfsPrefix = vfsPrefix;
    if (!vfsPort) {
      self.postMessage({ type: "error", data: "init requires vfsPort" });
      self.postMessage({ type: "exit", data: 1 });
      return;
    }

    const terminal = {
      write: (t: string) => self.postMessage({ type: "stdout", data: t }),
      writeError: (t: string) => self.postMessage({ type: "stderr", data: t }),
    };
    workerTerminal = terminal;

    if (args) {
      try {
        await runInWorker(
          vfsPort,
          terminal,
          args,
          cwd,
          env,
          wasmBytes,
          tcpRegPort,
          syncFsSab,
          syncFsPort,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        self.postMessage({ type: "stderr", data: msg + "\n" });
        self.postMessage({ type: "exit", data: 1 });
      }
      return;
    }

    if (!filename) {
      self.postMessage({
        type: "error",
        data: "init requires filename or args",
      });
      self.postMessage({ type: "exit", data: 1 });
      return;
    }

    (globalThis as Record<string, unknown>).workerData = workerData;
    (globalThis as Record<string, unknown>).parentPort = parentPort;
    (globalThis as Record<string, unknown>).isMainThread = false;
    (globalThis as Record<string, unknown>).threadId = threadId;

    try {
      const resolvedPath = PathUtils.isAbsolute(filename)
        ? PathUtils.normalize(filename)
        : PathUtils.join(cwd, filename);
      await runInWorker(
        vfsPort,
        terminal,
        [resolvedPath],
        cwd,
        env,
        wasmBytes,
        undefined,
        syncFsSab,
        syncFsPort,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      self.postMessage({ type: "error", data: msg });
      self.postMessage({ type: "exit", data: 1 });
    } finally {
      workerTerminal = null;
    }
    return;
  }

  if (data.type === "message") {
    const payload = data as { type: string; data?: unknown };
    for (const fn of parentPortListeners) {
      try {
        fn(payload.data);
      } catch {}
    }
  }
};
