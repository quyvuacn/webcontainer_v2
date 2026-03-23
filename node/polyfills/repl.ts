/**
 * Node repl polyfill — interactive REPL. Not available in browser context.
 * Stub to prevent crashes in packages that optionally require repl.
 */

import EventEmitter from "eventemitter3";

class REPLServer extends EventEmitter {
  context: Record<string, unknown> = {};
  historySize = 30;
  input: unknown = null;
  output: unknown = null;
  terminal = false;

  close(): void {
    this.emit("close");
  }

  defineCommand(
    _keyword: string,
    _cmd: { help?: string; action: (text: string) => void } | ((text: string) => void),
  ): void {}

  displayPrompt(_preserveCursor?: boolean): void {}

  clearBufferedCommand(): void {}

  setupHistory(_historyPath: string, _cb: (err: Error | null, repl: this) => void): void {}
}

function start(
  _options?:
    | string
    | {
        prompt?: string;
        input?: unknown;
        output?: unknown;
        terminal?: boolean;
        eval?: unknown;
        useColors?: boolean;
        useGlobal?: boolean;
        ignoreUndefined?: boolean;
        writer?: unknown;
        completer?: unknown;
        replMode?: symbol;
        breakEvalOnSigint?: boolean;
      },
): REPLServer {
  return new REPLServer();
}

export function createReplPolyfill(): Record<string, unknown> {
  return {
    REPLServer,
    start,
    REPL_MODE_SLOPPY: Symbol("repl-sloppy"),
    REPL_MODE_STRICT: Symbol("repl-strict"),
    Recoverable: class Recoverable extends Error {
      err: Error;
      constructor(err: Error) {
        super(err.message);
        this.err = err;
      }
    },
    builtinModules: [],
  };
}
