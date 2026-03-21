/**
 * node-runtime-hooks.ts
 *
 * Injects global hooks that the Node.js polyfills need:
 *
 *   globalThis.__setupVirtualPort  ← http.ts: http.createServer().listen(port)
 *   globalThis.__runNode           ← child_process.ts: spawn('node', args)
 *   globalThis.__spawnWorkerThreadsWorker ← worker_threads.ts: new Worker(file)
 *
 * Call installNodeRuntimeHooks() once after bootstrap completes, before
 * running any user Node.js code.
 */

import { RunNodeOptions } from "../cli";
import type { VirtualFS } from "../vfs/core/vfs";

export interface NodeRuntimeHooksOptions {
  /** VFS instance used by runNode and Worker scripts */
  vfs: VirtualFS;
  /** Register a port with the Virtual TCP SW pipe */
  setupVirtualPort: (
    port: number,
    handler: (req: unknown, res: unknown) => void,
  ) => void;
  /** Run a Node.js script, returns exit code */
  runNode: (args: string[], opts?: RunNodeOptions) => Promise<number>;
  /** Register worker VFS port (main thread handles read/write via MessagePort) */
  registerWorkerVfsPort?: (port: MessagePort) => void;
  /** Path to the worker_threads Web Worker entrypoint */
  workerThreadsWorkerUrl?: string;
}

/**
 * Install global hooks needed by Node.js polyfills.
 * Idempotent — safe to call multiple times.
 */
export function installNodeRuntimeHooks(opts: NodeRuntimeHooksOptions): void {
  const g = globalThis as Record<string, unknown>;

  // ── http.createServer().listen(port) ────────────────────────────────────────
  g.__setupVirtualPort = (port: number, handler: (req: unknown, res: unknown) => void) => {
    (g.__wcActiveServerCount as number)++;
    opts.setupVirtualPort(port, handler);
  };

  // ── child_process.spawn('node', args) ──────────────────────────────────────
  // Wrap runNode so stdout/stderr are piped to the ChildProcess EventEmitter.
  g.__runNode = async (
    args: string[],
    spawnOpts: { cwd?: string; env?: Record<string, string> } = {},
  ): Promise<number> => {
    return opts.runNode(args, {
      cwd: spawnOpts.cwd,
      env: spawnOpts.env,
    });
  };

  // ── worker_threads.Worker(filename) ────────────────────────────────────────
  g.__spawnWorkerThreadsWorker = (
    filename: string,
    workerData: unknown,
    threadId: number,
    spawnOpts?: { cwd?: string; env?: Record<string, string> },
  ): Worker => {
    const workerUrl =
      opts.workerThreadsWorkerUrl ?? "/js/worker_threads_runner.ts";
    const worker = new Worker(workerUrl, { type: "module" });

    const { port1, port2 } = new MessageChannel();
    opts.registerWorkerVfsPort?.(port1);

    worker.postMessage(
      {
        type: "init",
        vfsPort: port2,
        filename,
        workerData,
        cwd: spawnOpts?.cwd ?? "/",
        env: spawnOpts?.env ?? {},
        threadId,
      },
      [port2],
    );

    return worker;
  };
}

/**
 * Remove all installed hooks (useful for testing / cleanup).
 */
export function uninstallNodeRuntimeHooks(): void {
  const g = globalThis as Record<string, unknown>;
  delete g.__setupVirtualPort;
  delete g.__runNode;
  delete g.__spawnWorkerThreadsWorker;
  delete g.__wcActiveServerCount;
}
