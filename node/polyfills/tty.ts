/**
 * Node tty module polyfill — ReadStream and WriteStream with TTY methods.
 */

import EventEmitter from "eventemitter3";

export class ReadStream extends EventEmitter {
  readonly isTTY = false;
  readonly readable = true;
  readonly fd = 0;
  isRaw = false;

  setRawMode(mode: boolean): this {
    this.isRaw = mode;
    return this;
  }

  setEncoding(_encoding: string): this {
    return this;
  }

  resume(): this {
    return this;
  }

  pause(): this {
    return this;
  }

  read(): null {
    return null;
  }

  destroy(): this {
    return this;
  }
}

export class WriteStream extends EventEmitter {
  readonly isTTY = true;
  readonly writable = true;
  columns = 80;
  rows = 24;
  fd: number;

  constructor(fd: number) {
    super();
    this.fd = fd;
  }

  write(
    _chunk: string | Uint8Array,
    _encoding?: string,
    cb?: (err?: Error) => void,
  ): boolean {
    cb?.();
    return true;
  }

  end(_chunk?: unknown, _encoding?: unknown, cb?: () => void): this {
    if (typeof cb === "function") cb();
    return this;
  }

  cursorTo(x: number, _y?: number, cb?: () => void): boolean {
    void x;
    cb?.();
    return true;
  }

  moveCursor(_dx: number, _dy: number, cb?: () => void): boolean {
    cb?.();
    return true;
  }

  clearLine(_dir: number, cb?: () => void): boolean {
    cb?.();
    return true;
  }

  clearScreenDown(cb?: () => void): boolean {
    cb?.();
    return true;
  }

  getColorDepth(_env?: Record<string, string>): number {
    return 8;
  }

  hasColors(depth?: number): boolean {
    return (depth ?? 8) <= 8;
  }

  getWindowSize(): [number, number] {
    return [this.columns, this.rows];
  }

  destroy(): this {
    return this;
  }
}

export function createTtyPolyfill() {
  return {
    isatty: (fd: number): boolean => fd === 1 || fd === 2,
    ReadStream,
    WriteStream,
  };
}
