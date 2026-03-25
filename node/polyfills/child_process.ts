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
    pipe?: <T>(dest: T) => T;
  };
  stderr = new EventEmitter() as EventEmitter & {
    setEncoding?: (enc: string) => void;
    pipe?: <T>(dest: T) => T;
  };

  // stdin: a writable-like interface whose chunks are drained by the child runner.
  // The queue + resolver pattern lets spawnNode deliver chunks async to __runNode.
  private _stdinQueue: Array<Uint8Array | null> = [];  // null = EOF
  private _stdinWaiter: ((v: Uint8Array | null) => void) | null = null;

  stdin = {
    write: (chunk: string | Uint8Array, _enc?: string, cb?: (err?: Error) => void): boolean => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
      if (this._stdinWaiter) {
        const w = this._stdinWaiter;
        this._stdinWaiter = null;
        w(bytes);
      } else {
        this._stdinQueue.push(bytes);
      }
      cb?.();
      return true;
    },
    end: (chunk?: unknown, _enc?: unknown, cb?: () => void): void => {
      if (chunk && typeof (chunk as string | Uint8Array).length !== "undefined") {
        this.stdin.write(chunk as string | Uint8Array);
      }
      // Push EOF marker
      if (this._stdinWaiter) {
        const w = this._stdinWaiter;
        this._stdinWaiter = null;
        w(null);
      } else {
        this._stdinQueue.push(null);
      }
      cb?.();
    },
    on: (_event: string, _fn: unknown): void => {},
    setEncoding: (_enc: string): void => {},
    writable: true,
  };

  // Called by the runner to read one stdin chunk (or null for EOF).
  _readStdin(): Promise<Uint8Array | null> {
    if (this._stdinQueue.length > 0) {
      return Promise.resolve(this._stdinQueue.shift()!);
    }
    return new Promise<Uint8Array | null>((resolve) => {
      this._stdinWaiter = resolve;
    });
  }

  // AbortController for killing the underlying __runNode promise.
  private _abortCtrl = new AbortController();
  get _signal(): AbortSignal { return this._abortCtrl.signal; }

  constructor() {
    super();
    this.stdout.setEncoding = (_enc: string) => {};
    this.stderr.setEncoding = (_enc: string) => {};
    // Minimal pipe() so proc.stdout.pipe(dest) works
    this.stdout.pipe = <T extends { write: (c: unknown) => void; end: () => void }>(dest: T): T => {
      this.stdout.on("data", (chunk: unknown) => dest.write(chunk));
      this.once("close", () => dest.end());
      return dest;
    };
    this.stderr.pipe = <T extends { write: (c: unknown) => void; end: () => void }>(dest: T): T => {
      this.stderr.on("data", (chunk: unknown) => dest.write(chunk));
      this.once("close", () => dest.end());
      return dest;
    };
  }

  kill(signal?: string): boolean {
    this.killed = true;
    this.signalCode = signal ?? "SIGTERM";
    this._abortCtrl.abort();
    return true;
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
  // Extended opts: __proc carries the ChildProcess for stdout/stderr routing,
  // __stdinReader lets the runner pull stdin chunks, __signal allows kill().
  const runNode = (globalThis as Record<string, unknown>).__runNode as
    | ((args: string[], opts: SpawnOptions & {
        __proc?: ChildProcess;
        __stdinReader?: () => Promise<Uint8Array | null>;
        __signal?: AbortSignal;
      }) => Promise<number>)
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
        __stdinReader: () => proc._readStdin(),
        __signal: proc._signal,
      });
      proc.exitCode = exitCode;
      proc.emit("close", exitCode, null);
      proc.emit("exit", exitCode, null);
    } catch (e) {
      // Treat abort as normal kill — emit close with null signal code
      if (proc.killed) {
        proc.exitCode = null;
        proc.emit("close", null, proc.signalCode);
        proc.emit("exit", null, proc.signalCode);
      } else {
        proc.emit("error", e instanceof Error ? e : new Error(String(e)));
      }
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
      const opts: SpawnOptions = typeof optsOrCb === "object" ? optsOrCb : {};

      // Shell-like tokenizer: handles single/double quotes and backslash escapes.
      const tokenize = (s: string): string[] => {
        const tokens: string[] = [];
        let cur = "";
        let quote: string | null = null;
        for (let i = 0; i < s.length; i++) {
          const ch = s[i]!;
          if (ch === "\\" && !quote) { cur += s[++i] ?? ""; continue; }
          if ((ch === '"' || ch === "'") && !quote) { quote = ch; continue; }
          if (ch === quote) { quote = null; continue; }
          if (ch === " " && !quote) {
            if (cur) { tokens.push(cur); cur = ""; }
            continue;
          }
          cur += ch;
        }
        if (cur) tokens.push(cur);
        return tokens;
      };

      const tokens = tokenize(cmd.trim());
      const executable = tokens[0] ?? "";
      const args = tokens.slice(1);

      // Route node / npm / npx through spawnNode
      const isNode = /^(node|node\d+|npm|npx)$/.test(executable);
      if (isNode) {
        let stdout = "";
        let stderr = "";
        const child = spawnNode(executable, args, opts);
        child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
        child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
        child.on("close", (code: number | null) => {
          if (code === 0 || code === null) callback?.(null, stdout, stderr);
          else callback?.(new Error(`Process exited with code ${code}`), stdout, stderr);
        });
        return child;
      }

      const proc = new ChildProcess();
      queueMicrotask(() => {
        callback?.(new Error(`exec: "${executable}" command not found in browser`), "", "");
        proc.exitCode = 127;
        proc.emit("close", 127, null);
        proc.emit("exit", 127, null);
      });
      return proc;
    },

    execFile(
      file: string,
      argsOrOptsOrCb?: string[] | SpawnOptions | ((err: Error | null, stdout: string, stderr: string) => void),
      optsOrCb?: SpawnOptions | ((err: Error | null, stdout: string, stderr: string) => void),
      cb?: (err: Error | null, stdout: string, stderr: string) => void,
    ): ChildProcess {
      // Normalize overloaded args: execFile(file, args?, opts?, cb?)
      let fileArgs: string[] = [];
      let opts: SpawnOptions = {};
      let callback: ((err: Error | null, stdout: string, stderr: string) => void) | undefined;

      if (Array.isArray(argsOrOptsOrCb)) {
        fileArgs = argsOrOptsOrCb;
        if (typeof optsOrCb === "function") callback = optsOrCb;
        else if (optsOrCb && typeof optsOrCb === "object") {
          opts = optsOrCb;
          callback = cb;
        }
      } else if (typeof argsOrOptsOrCb === "function") {
        callback = argsOrOptsOrCb;
      } else if (argsOrOptsOrCb && typeof argsOrOptsOrCb === "object") {
        opts = argsOrOptsOrCb;
        callback = typeof optsOrCb === "function" ? optsOrCb : cb;
      }

      // Route node / npm / npx
      const isNode = /^(node|node\d+|npm|npx)$/.test(file);
      if (isNode) {
        let stdout = "";
        let stderr = "";
        const child = spawnNode(file, fileArgs, opts);
        child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
        child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
        child.on("close", (code: number | null) => {
          if (code === 0 || code === null) callback?.(null, stdout, stderr);
          else callback?.(new Error(`Process exited with code ${code}`), stdout, stderr);
        });
        return child;
      }

      const proc = new ChildProcess();
      queueMicrotask(() => {
        callback?.(new Error(`execFile: "${file}" not found in browser`), "", "");
        proc.exitCode = 127;
        proc.emit("close", 127, null);
        proc.emit("exit", 127, null);
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
