/**
 * Node child_process polyfill.
 *
 * spawn('node', args) → routes to globalThis.__runNode (injected by main.js)
 * which calls runNode() from cli.ts inside a microtask, piping stdout/stderr
 * back through the EventEmitter interface.
 *
 * All other commands (non-node binaries) emit an error — browser has no shell.
 */

import EventEmitter from "eventemitter3";
import { Buffer } from "buffer";

// ── ChildProcess ───────────────────────────────────────────────────────────────

class ChildProcess extends EventEmitter {
  pid = Math.floor(Math.random() * 65535) + 1;
  exitCode: number | null = null;
  signalCode: string | null = null;
  killed = false;

  stdout = new EventEmitter() as EventEmitter & {
    setEncoding?: (enc: string) => void;
  };
  stderr = new EventEmitter() as EventEmitter & {
    setEncoding?: (enc: string) => void;
  };
  stdin = {
    write: (
      _chunk: string | Uint8Array,
      _enc?: string,
      cb?: (err?: Error) => void,
    ) => {
      cb?.();
      return true;
    },
    end: (_chunk?: unknown, _enc?: unknown, cb?: () => void) => {
      cb?.();
    },
    on: (_event: string, _fn: unknown) => {},
  };

  constructor() {
    super();
    this.stdout.setEncoding = (_enc: string) => {};
    this.stderr.setEncoding = (_enc: string) => {};
  }

  kill(_signal?: string): boolean {
    this.killed = true;
    return false;
  }
}

// ── Internal helpers ───────────────────────────────────────────────────────────

type SpawnOptions = {
  cwd?: string;
  env?: Record<string, string>;
  stdio?: string | string[];
};

function spawnNode(
  cmd: string,
  args: string[],
  opts: SpawnOptions,
): ChildProcess {
  const proc = new ChildProcess();

  // globalThis.__runNode is injected by main.js bootstrap.
  // Signature: (args: string[], opts: { cwd?: string; env?: Record<string, string> }) => Promise<number>
  const runNode = (globalThis as Record<string, unknown>).__runNode as
    | ((args: string[], opts: SpawnOptions) => Promise<number>)
    | undefined;

  if (!runNode) {
    queueMicrotask(() => {
      proc.emit(
        "error",
        new Error(
          "child_process.spawn: __runNode not available (bootstrap incomplete)",
        ),
      );
    });
    return proc;
  }

  const scriptArgs = cmd === "node" ? args : [cmd, ...args];

  queueMicrotask(async () => {
    try {
      const exitCode = await runNode(scriptArgs, {
        cwd: opts.cwd,
        env: opts.env,
        __proc: proc,
      } as SpawnOptions & { __proc?: ChildProcess });
      proc.exitCode = exitCode;
      proc.emit("close", exitCode, null);
      proc.emit("exit", exitCode, null);
    } catch (e) {
      proc.emit("error", e instanceof Error ? e : new Error(String(e)));
    }
  });

  return proc;
}

function spawnOther(cmd: string): ChildProcess {
  const proc = new ChildProcess();
  queueMicrotask(() => {
    proc.stderr.emit("data", Buffer.from(`${cmd}: command not found\n`));
    proc.exitCode = 127;
    proc.emit("close", 127, null);
    proc.emit("exit", 127, null);
  });
  return proc;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function createChildProcessPolyfill() {
  return {
    spawn(
      cmd: string,
      args: string[] = [],
      opts: SpawnOptions = {},
    ): ChildProcess {
      if (cmd === "node" || cmd === "node20" || cmd === "node18") {
        return spawnNode(cmd, args, opts);
      }
      // npm run, npx → also route through node
      if (cmd === "npm" || cmd === "npx") {
        return spawnNode("node", [`__${cmd}__`, ...args], opts);
      }
      return spawnOther(cmd);
    },

    exec(
      cmd: string,
      optsOrCb?:
        | SpawnOptions
        | ((err: Error | null, stdout: string, stderr: string) => void),
      cb?: (err: Error | null, stdout: string, stderr: string) => void,
    ): ChildProcess {
      const callback = typeof optsOrCb === "function" ? optsOrCb : cb;
      const proc = new ChildProcess();

      // Route simple `node script.js` exec invocations
      const match = /^node\s+(.+)$/.exec(cmd.trim());
      if (match) {
        const scriptArgs = match[1]!.split(/\s+/);
        let stdout = "";
        let stderr = "";
        const opts: SpawnOptions = typeof optsOrCb === "object" ? optsOrCb : {};
        const child = spawnNode("node", scriptArgs, opts);
        child.stdout.on("data", (d: Buffer) => {
          stdout += d.toString();
        });
        child.stderr.on("data", (d: Buffer) => {
          stderr += d.toString();
        });
        child.on("close", (code: number) => {
          if (code === 0) callback?.(null, stdout, stderr);
          else
            callback?.(
              new Error(`Process exited with code ${code}`),
              stdout,
              stderr,
            );
        });
        return child;
      }

      queueMicrotask(() => {
        callback?.(
          new Error(`exec: "${cmd}" not supported in browser`),
          "",
          "",
        );
      });
      return proc;
    },

    execFile(
      _file: string,
      _argsOrOptsOrCb?: unknown,
      _optsOrCb?: unknown,
      cb?: (err: Error | null, stdout: string, stderr: string) => void,
    ): ChildProcess {
      const proc = new ChildProcess();
      queueMicrotask(() => {
        cb?.(new Error("execFile: not supported in browser"), "", "");
      });
      return proc;
    },

    fork(
      _modulePath: string,
      _args?: string[],
      _opts?: SpawnOptions,
    ): ChildProcess {
      // fork() is not supported but return a stub ChildProcess instead of crashing
      const proc = new ChildProcess();
      queueMicrotask(() => {
        proc.stderr.emit(
          "data",
          Buffer.from("child_process.fork: not supported in browser\n"),
        );
        proc.exitCode = 1;
        proc.emit("close", 1, null);
        proc.emit("exit", 1, null);
      });
      return proc;
    },

    execSync(_cmd: string, _opts?: SpawnOptions): Buffer {
      throw new Error(
        "child_process.execSync: not supported in browser (use async spawn)",
      );
    },

    execFileSync(
      _file: string,
      _args?: string[],
      _opts?: SpawnOptions,
    ): Buffer {
      throw new Error("child_process.execFileSync: not supported in browser");
    },

    spawnSync(cmd: string, args: string[] = [], _opts: SpawnOptions = {}) {
      return {
        pid: 0,
        status: 1,
        signal: null,
        output: [null, Buffer.alloc(0), Buffer.alloc(0)],
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(
          `spawnSync("${cmd}"): use async spawn in browser\n`,
        ),
        error: new Error(`child_process.spawnSync: not supported in browser`),
      };
    },
  };
}
