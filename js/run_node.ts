import { runNode } from "../node/cli";
import { createVirtualFSAdapter } from "../node/vfs/core/adapter";
import {
  registerWorkerVfsPort,
  setupVirtualPort,
  teardownVirtualPort,
  registerSyncVfsChannel,
} from "./main";
import { createSyncVfsSab } from "./lib/sync_vfs_channel";
import { VFS_PREFIX } from "./config";

export type WorkerRefSlot = {
  current: {
    worker: Worker;
    resolve: (code: number) => void;
    children: Worker[];
  } | null;
};

export function createNodeRunner(
  _rawVfs: unknown,
  terminal: { write: (s: string) => void; writeError?: (s: string) => void },
  workerRefSlot: WorkerRefSlot,
) {
  const clientId = crypto.randomUUID();
  return async (
    args: string[],
    opts: { cwd?: string; env?: Record<string, string> } = {},
  ): Promise<number> => {
    const { port1, port2 } = new MessageChannel();
    registerWorkerVfsPort(port1);

    const { port1: tcpReg1, port2: tcpReg2 } = new MessageChannel();
    type PortPending = Map<
      string,
      (d: {
        status: number;
        headers: [string, string][];
        body: number[];
      }) => void
    >;
    const workerPortMap = new Map<
      number,
      { reqPort: MessagePort; pending: PortPending }
    >();
    tcpReg1.onmessage = ({
      data,
    }: MessageEvent<{
      type: string;
      port?: number;
      requestPort?: MessagePort;
      ackPort?: MessagePort;
      clientId?: string;
    }>) => {
      if (
        data.type === "unregister_virtual_port" &&
        data.port != null &&
        data.clientId
      ) {
        teardownVirtualPort(data.port, data.clientId);
        return;
      }
      if (
        data.type === "register_virtual_port" &&
        data.port != null &&
        data.requestPort
      ) {
        const port = data.port;
        const reqPort = data.requestPort;
        const pending = new Map<
          string,
          (d: {
            status: number;
            headers: [string, string][];
            body: number[];
          }) => void
        >();
        reqPort.onmessage = ({
          data: d,
        }: MessageEvent<{
          type: string;
          requestId?: string;
          status?: number;
          headers?: [string, string][];
          body?: number[];
        }>) => {
          if (d.type === "virtual_tcp_response" && d.requestId) {
            const cb = pending.get(d.requestId);
            if (cb) {
              pending.delete(d.requestId);
              cb({
                status: d.status ?? 200,
                headers: d.headers ?? [],
                body: d.body ?? [],
              });
            }
          }
        };
        workerPortMap.set(port, { reqPort, pending });
        const cId = data.clientId ?? clientId;
        const result = setupVirtualPort(
          port,
          (
            req: {
              method?: string;
              url?: string;
              path?: string;
              headers?: Record<string, string>;
              on?: (ev: string, fn: (chunk?: unknown) => void) => unknown;
            },
            res: {
              setHeader: (k: string, v: string) => void;
              end: (b?: string | Uint8Array) => void;
            },
          ) => {
            const headers: [string, string][] = req.headers
              ? Object.entries(req.headers)
              : [];
            const body: number[] = [];
            const path =
              (req.path || "/").replace(/^\/__port__\/\d+/, "") || "/";
            const q = (req.url || "").includes("?")
              ? (req.url || "").slice((req.url || "").indexOf("?"))
              : "";
            const fwdUrl = path + q;
            const collect = () => {
              const requestId = crypto.randomUUID();
              const p = new Promise<{
                status: number;
                headers: [string, string][];
                body: number[];
              }>((resolve) => {
                pending.set(requestId, resolve);
              });
              reqPort.postMessage({
                type: "virtual_tcp_request",
                requestId,
                method: req.method ?? "GET",
                url: fwdUrl,
                headers,
                body,
              });
              p.then(({ status, headers: h, body: b }) => {
                h.forEach(([k, v]) => res.setHeader(k, v));
                (res as { statusCode?: number }).statusCode = status;
                res.end(b.length ? new Uint8Array(b) : "");
              });
            };
            if (req.on) {
              req.on("data", (chunk: Uint8Array) => {
                body.push(...chunk);
              });
              req.on("end", collect);
            } else {
              collect();
            }
          },
          cId,
        );
        if (data.ackPort) {
          if (result.ok === false)
            data.ackPort.postMessage({ error: result.error });
          else data.ackPort.postMessage({ ok: true });
        }
      }
    };

    const worker = new Worker(
      new URL("./worker_threads_runner.ts", import.meta.url),
      { type: "module" },
    );
    const ref = {
      worker,
      resolve: (_code: number) => {},
      children: [] as Worker[],
    };
    workerRefSlot.current = ref;

    return new Promise<number>((resolve) => {
      ref.resolve = resolve;
      const cleanup = () => {
        workerRefSlot.current = null;
        ref.children.forEach((c) => c.terminate());
        worker.terminate();
      };
      worker.onmessage = ({
        data,
      }: MessageEvent<{
        type: string;
        data?: string | number;
        requestId?: number;
        args?: string[];
        cwd?: string;
        env?: Record<string, string>;
      }>) => {
        if (data.type === "spawn") {
          const requestId = data.requestId ?? 0;
          const { port1: p1, port2: p2 } = new MessageChannel();
          registerWorkerVfsPort(p1);
          const { port1: tcpRegC1, port2: tcpRegC2 } = new MessageChannel();
          tcpRegC1.onmessage = ({
            data: d,
          }: MessageEvent<{
            type: string;
            port?: number;
            requestPort?: MessagePort;
            ackPort?: MessagePort;
            clientId?: string;
          }>) => {
            if (
              d.type === "unregister_virtual_port" &&
              d.port != null &&
              d.clientId
            ) {
              teardownVirtualPort(d.port, d.clientId);
              return;
            }
            if (
              d.type === "register_virtual_port" &&
              d.port != null &&
              d.requestPort
            ) {
              const port = d.port;
              const reqPort = d.requestPort;
              const cId = d.clientId ?? crypto.randomUUID();
              const pending = new Map<
                string,
                (d: {
                  status: number;
                  headers: [string, string][];
                  body: number[];
                }) => void
              >();
              reqPort.onmessage = ({
                data: r,
              }: MessageEvent<{
                type: string;
                requestId?: string;
                status?: number;
                headers?: [string, string][];
                body?: number[];
              }>) => {
                if (r.type === "virtual_tcp_response" && r.requestId) {
                  const cb = pending.get(r.requestId);
                  if (cb) {
                    pending.delete(r.requestId);
                    cb({
                      status: r.status ?? 200,
                      headers: r.headers ?? [],
                      body: r.body ?? [],
                    });
                  }
                }
              };
              workerPortMap.set(port, { reqPort, pending });
              const result = setupVirtualPort(
                port,
                (
                  req: {
                    method?: string;
                    url?: string;
                    path?: string;
                    headers?: Record<string, string>;
                    on?: (ev: string, fn: (chunk?: unknown) => void) => unknown;
                  },
                  res: {
                    setHeader: (k: string, v: string) => void;
                    end: (b?: string | Uint8Array) => void;
                  },
                ) => {
                  const headers: [string, string][] = req.headers
                    ? Object.entries(req.headers)
                    : [];
                  const body: number[] = [];
                  const path =
                    ((req as { path?: string }).path || "/").replace(
                      /^\/__port__\/\d+/,
                      "",
                    ) || "/";
                  const q = (req.url || "").includes("?")
                    ? (req.url || "").slice((req.url || "").indexOf("?"))
                    : "";
                  const fwdUrl = path + q;
                  const collect = () => {
                    const rid = crypto.randomUUID();
                    const pr = new Promise<{
                      status: number;
                      headers: [string, string][];
                      body: number[];
                    }>((resolve) => {
                      pending.set(rid, resolve);
                    });
                    reqPort.postMessage({
                      type: "virtual_tcp_request",
                      requestId: rid,
                      method: req.method ?? "GET",
                      url: fwdUrl,
                      headers,
                      body,
                    });
                    pr.then(({ status, headers: h, body: b }) => {
                      h.forEach(([k, v]) => res.setHeader(k, v));
                      (res as { statusCode?: number }).statusCode = status;
                      res.end(b.length ? new Uint8Array(b) : "");
                    });
                  };
                  if (req.on) {
                    req.on("data", (chunk: Uint8Array) => {
                      body.push(...chunk);
                    });
                    req.on("end", collect);
                  } else collect();
                },
                cId,
              );
              if (d.ackPort) {
                if (result.ok === false)
                  d.ackPort.postMessage({ error: result.error });
                else d.ackPort.postMessage({ ok: true });
              }
            }
          };
          const child = new Worker(
            new URL("./worker_threads_runner.ts", import.meta.url),
            { type: "module" },
          );
          ref.children.push(child);
          child.onmessage = ({
            data: d,
          }: MessageEvent<{ type: string; data?: string | number }>) => {
            if (d.type === "stdout")
              worker.postMessage({
                type: "spawn_stdout",
                requestId,
                data: d.data,
              });
            else if (d.type === "stderr")
              worker.postMessage({
                type: "spawn_stderr",
                requestId,
                data: d.data,
              });
            else if (d.type === "exit") {
              worker.postMessage({
                type: "spawn_response",
                requestId,
                exitCode: (d.data as number) ?? 1,
              });
              child.terminate();
              const i = ref.children.indexOf(child);
              if (i >= 0) ref.children.splice(i, 1);
            }
          };
          child.onerror = () => {
            worker.postMessage({
              type: "spawn_response",
              requestId,
              exitCode: 1,
            });
            child.terminate();
            const i = ref.children.indexOf(child);
            if (i >= 0) ref.children.splice(i, 1);
          };
          // SAB sync-VFS channel for child worker
          const childSyncFsSab = createSyncVfsSab();
          const { port1: childSyncIn, port2: childSyncOut } =
            new MessageChannel();
          registerSyncVfsChannel(childSyncFsSab, childSyncIn);

          const wbytes = (globalThis as { __wcEsbuildWasmBytes?: ArrayBuffer })
            .__wcEsbuildWasmBytes;
          const wcopy = wbytes?.slice(0);
          const t: Transferable[] = [p2, tcpRegC2, childSyncOut];
          if (wcopy) t.push(wcopy);
          child.postMessage(
            {
              type: "init",
              vfsPort: p2,
              tcpRegPort: tcpRegC2,
              syncFsSab: childSyncFsSab,
              syncFsPort: childSyncOut,
              args: data.args ?? [],
              cwd: data.cwd ?? opts.cwd ?? "project",
              env: data.env ?? opts.env ?? {},
              wasmBytes: wcopy,
              vfsPrefix: VFS_PREFIX,
            },
            t,
          );
          return;
        }
        if (data.type === "stdout") terminal.write(String(data.data ?? ""));
        else if (data.type === "stderr")
          (terminal.writeError ?? terminal.write)(String(data.data ?? ""));
        else if (data.type === "exit") {
          cleanup();
          resolve((data.data as number) ?? 1);
        }
      };
      worker.onerror = (e) => {
        (terminal.writeError ?? terminal.write)(`Worker error: ${e.message}\n`);
        cleanup();
        resolve(1);
      };
      // SAB sync-VFS channel for readFileSync / existsSync
      const syncFsSab = createSyncVfsSab();
      const { port1: syncFsIn, port2: syncFsOut } = new MessageChannel();
      registerSyncVfsChannel(syncFsSab, syncFsIn);

      const wasmBytes = (globalThis as { __wcEsbuildWasmBytes?: ArrayBuffer })
        .__wcEsbuildWasmBytes;
      const wasmCopy = wasmBytes?.slice(0);
      const transfer: Transferable[] = [port2, tcpReg2, syncFsOut];
      if (wasmCopy) transfer.push(wasmCopy);
      worker.postMessage(
        {
          type: "init",
          vfsPort: port2,
          tcpRegPort: tcpReg2,
          syncFsSab,
          syncFsPort: syncFsOut,
          args,
          cwd: opts.cwd ?? "project",
          env: opts.env ?? {},
          wasmBytes: wasmCopy,
          vfsPrefix: VFS_PREFIX,
        },
        transfer,
      );
    });
  };
}

export function terminateWorkerInSlot(slot: WorkerRefSlot): boolean {
  const ref = slot.current;
  if (ref) {
    ref.children.forEach((c) => c.terminate());
    ref.children.length = 0;
    ref.resolve(130);
    ref.worker.terminate();
    slot.current = null;
    return true;
  }
  return false;
}

export function createSpawnSyncAsync(rawVfs: unknown) {
  const vfs = createVirtualFSAdapter(
    rawVfs as Parameters<typeof createVirtualFSAdapter>[0],
  );
  return async (
    filePath: string,
    args: string[] = [],
    opts: { cwd?: string; env?: Record<string, string> } = {},
  ) => {
    const out: string[] = [],
      err: string[] = [];
    const terminal = {
      write: (t: string) => out.push(t),
      writeError: (t: string) => err.push(t),
    };
    const cwd = opts.cwd || "project";
    const entry = filePath.startsWith("/") ? filePath : "/" + filePath;
    const status = await runNode([entry, ...args], vfs, terminal, {
      cwd,
      env: opts.env,
    });
    return { stdout: out.join(""), stderr: err.join(""), status };
  };
}
