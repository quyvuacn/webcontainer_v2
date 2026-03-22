/**
 * Node worker_threads polyfill.
 *
 * Worker(filename) → spawns a real Web Worker that:
 *   1. Loads the VFS WASM to get a read-only file view
 *   2. Reads and executes the script via runNode()
 *   3. Bridges postMessage / on('message') through the Web Worker API
 *
 * globalThis.__spawnWorkerThreadsWorker is injected by main.js bootstrap.
 * If not available (test env), Worker throws.
 */

import EventEmitter from "eventemitter3";

// ── Worker ─────────────────────────────────────────────────────────────────────

export class WorkerThreadWorker extends EventEmitter {
  private _webWorker: Worker | null = null;
  private _terminated = false;
  threadId: number;
  private static _nextId = 1;

  constructor(filename: string, options: Record<string, unknown> = {}) {
    super();
    this.threadId = WorkerThreadWorker._nextId++;

    // __spawnWorkerThreadsWorker injected by main.js
    const spawn = (globalThis as Record<string, unknown>)
      .__spawnWorkerThreadsWorker as
      | ((
          filename: string,
          workerData: unknown,
          threadId: number,
          opts?: { cwd?: string; env?: Record<string, string> },
        ) => Worker)
      | undefined;

    if (typeof spawn !== "function") {
      throw new Error(
        "worker_threads.Worker: __spawnWorkerThreadsWorker not available. " +
          "Ensure bootstrap has completed before creating Workers.",
      );
    }

    try {
      const webWorker = spawn(
        filename,
        options.workerData ?? null,
        this.threadId,
        {
          cwd: options.cwd as string | undefined,
          env: options.env as Record<string, string> | undefined,
        },
      );
      this._webWorker = webWorker;

      webWorker.onmessage = (ev: MessageEvent) => {
        const { type, data } = ev.data ?? {};
        if (type === "message") {
          this.emit("message", data);
        } else if (type === "error") {
          this.emit("error", new Error(String(data)));
        } else if (type === "exit") {
          this.emit("exit", data ?? 0);
        } else if (type === "stdout") {
          const p = (
            globalThis as unknown as {
              process?: { stdout?: { write?: (s: string) => void } };
            }
          ).process;
          p?.stdout?.write?.(data);
        } else if (type === "stderr") {
          const p = (
            globalThis as unknown as {
              process?: { stderr?: { write?: (s: string) => void } };
            }
          ).process;
          p?.stderr?.write?.(data);
        }
      };

      webWorker.onerror = (ev: ErrorEvent) => {
        this.emit("error", new Error(ev.message));
      };
    } catch (e) {
      queueMicrotask(() =>
        this.emit("error", e instanceof Error ? e : new Error(String(e))),
      );
    }
  }

  postMessage(value: unknown, transferList?: Transferable[]): void {
    if (this._terminated || !this._webWorker) return;
    this._webWorker.postMessage(
      { type: "message", data: value },
      transferList ?? [],
    );
  }

  terminate(): Promise<number> {
    this._terminated = true;
    this._webWorker?.terminate();
    this._webWorker = null;
    return Promise.resolve(0);
  }

  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
}

// ── MessageChannel / MessagePort ───────────────────────────────────────────────
// Delegate to browser's native MessageChannel — available in all modern browsers.

// ── Exports ────────────────────────────────────────────────────────────────────

export function createWorkerThreadsPolyfill(): Record<string, unknown> {
  const g = globalThis as Record<string, unknown>;
  return {
    Worker: WorkerThreadWorker,
    // Use dynamic getters so values reflect the actual execution context.
    // worker_threads_runner.ts sets these globals when running as a worker thread.
    get isMainThread() {
      return typeof g.isMainThread === "boolean" ? g.isMainThread : true;
    },
    get parentPort() {
      return g.parentPort ?? null;
    },
    get workerData() {
      return g.workerData ?? null;
    },
    get threadId() {
      return typeof g.threadId === "number" ? g.threadId : 0;
    },
    receiveMessageOnPort: () => null,
    MessageChannel: globalThis.MessageChannel,
    MessagePort: globalThis.MessagePort,
    markAsUntransferable: (obj: object) => obj,
    moveMessagePortToContext: (_port: unknown, _ctx: unknown) => _port,
    getEnvironmentData: (_key: unknown) => undefined,
    setEnvironmentData: (_key: unknown, _value: unknown) => {},
    SHARE_ENV: Symbol("SHARE_ENV"),
    resourceLimits: {
      maxOldGenerationSizeMb: 0,
      maxYoungGenerationSizeMb: 0,
      codeRangeSizeMb: 0,
      stackSizeMb: 0,
    },
  };
}
