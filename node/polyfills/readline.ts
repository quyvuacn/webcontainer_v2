/**
 * Node readline polyfill — Interface, cursorTo, clearLine, etc.
 * Vite uses readline to bind keyboard shortcuts (server.bindCLIShortcuts).
 */

import EventEmitter from "eventemitter3";

type StreamLike = {
  cursorTo?: (x: number, y?: number, cb?: () => void) => boolean;
  clearScreenDown?: (cb?: () => void) => boolean;
  clearLine?: (dir: number, cb?: () => void) => boolean;
  moveCursor?: (dx: number, dy: number, cb?: () => void) => boolean;
  write?: (s: string | Uint8Array, opts?: unknown, cb?: () => void) => boolean;
};

function cursorTo(
  stream: StreamLike,
  x: number,
  y?: number | (() => void),
  cb?: () => void,
): boolean {
  const callback = typeof y === "function" ? y : cb;
  const yVal = typeof y === "function" ? undefined : y;
  if (stream?.cursorTo) return stream.cursorTo(x, yVal, callback);
  callback?.();
  return true;
}

function clearScreenDown(stream: StreamLike, cb?: () => void): boolean {
  if (stream?.clearScreenDown) return stream.clearScreenDown(cb);
  cb?.();
  return true;
}

function clearLine(stream: StreamLike, dir: number, cb?: () => void): boolean {
  if (stream?.clearLine) return stream.clearLine(dir, cb);
  cb?.();
  return true;
}

function moveCursor(
  stream: StreamLike,
  dx: number,
  dy: number,
  cb?: () => void,
): boolean {
  if (stream?.moveCursor) return stream.moveCursor(dx, dy, cb);
  cb?.();
  return true;
}

function emitKeypressEvents(
  _stream: unknown,
  _interface?: unknown,
): void {
  // No-op in browser — keypresses are handled by xterm.js
}

class Interface extends EventEmitter {
  private _input: StreamLike;
  private _output: StreamLike | null;
  terminal: boolean;
  line = "";
  cursor = 0;

  constructor(
    inputOrOptions:
      | StreamLike
      | {
          input?: StreamLike;
          output?: StreamLike | null;
          terminal?: boolean;
          prompt?: string;
          completer?: unknown;
          crlfDelay?: number;
          removeHistoryDuplicates?: boolean;
          escapeCodeTimeout?: number;
          tabSize?: number;
        },
    output?: StreamLike | null,
    _completer?: unknown,
    _terminal?: boolean,
  ) {
    super();
    if (
      inputOrOptions &&
      typeof inputOrOptions === "object" &&
      "input" in inputOrOptions
    ) {
      const opts = inputOrOptions as {
        input?: StreamLike;
        output?: StreamLike | null;
        terminal?: boolean;
      };
      this._input = opts.input ?? ({} as StreamLike);
      this._output = opts.output ?? null;
      this.terminal = opts.terminal ?? false;
    } else {
      this._input = inputOrOptions as StreamLike;
      this._output = output ?? null;
      this.terminal = _terminal ?? false;
    }
  }

  setPrompt(_prompt: string): void {}

  getPrompt(): string {
    return "";
  }

  prompt(_preserveCursor?: boolean): void {
    this._output?.write?.("\r\n");
  }

  question(
    query: string,
    optionsOrCb:
      | { signal?: unknown }
      | ((answer: string) => void),
    cb?: (answer: string) => void,
  ): void {
    const callback =
      typeof optionsOrCb === "function" ? optionsOrCb : cb;
    this._output?.write?.(query);
    // In browser, immediately answer with empty string
    queueMicrotask(() => callback?.(""));
  }

  pause(): this {
    return this;
  }

  resume(): this {
    return this;
  }

  close(): void {
    this.emit("close");
  }

  write(data: string, _key?: unknown): void {
    this._output?.write?.(data);
  }

  getCursorPos(): { rows: number; cols: number } {
    return { rows: 0, cols: 0 };
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: () => Promise.resolve({ value: "", done: true }),
      return: () => Promise.resolve({ value: "", done: true }),
    };
  }
}

function createInterface(
  inputOrOptions:
    | StreamLike
    | {
        input?: StreamLike;
        output?: StreamLike | null;
        terminal?: boolean;
        completer?: unknown;
      },
  output?: StreamLike | null,
  completer?: unknown,
  terminal?: boolean,
): Interface {
  return new Interface(inputOrOptions, output, completer, terminal);
}

export function createReadlinePolyfill() {
  return {
    createInterface,
    Interface,
    cursorTo,
    clearScreenDown,
    clearLine,
    moveCursor,
    emitKeypressEvents,
    promises: {
      createInterface: (
        opts: Parameters<typeof createInterface>[0],
      ) => createInterface(opts),
    },
  };
}

