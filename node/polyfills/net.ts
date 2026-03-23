/**
 * Node net polyfill — virtual TCP sockets for browser.
 * Real TCP is handled by the SAB-based virtual port system (js/tcp_worker.ts).
 * This module provides a compatible API surface so packages that import 'net'
 * (e.g. http internals, ws, mysql clients) do not crash.
 */

import EventEmitter from "eventemitter3";

class Socket extends EventEmitter {
  readable = false;
  writable = false;
  destroyed = false;
  localAddress = "127.0.0.1";
  localPort = 0;
  remoteAddress = "127.0.0.1";
  remotePort = 0;
  bufferSize = 0;
  bytesRead = 0;
  bytesWritten = 0;
  connecting = false;
  pending = true;
  readyState: "closed" | "open" | "opening" = "closed";
  allowHalfOpen = false;

  address() {
    return {
      address: this.localAddress,
      family: "IPv4",
      port: this.localPort,
    };
  }
  connect(
    _portOrOptions: unknown,
    _hostOrCb?: unknown,
    _cb?: unknown,
  ): this {
    return this;
  }
  write(_data: unknown, _enc?: unknown, _cb?: unknown): boolean {
    return true;
  }
  end(_data?: unknown, _enc?: unknown, _cb?: unknown): this {
    this.destroyed = true;
    this.readyState = "closed";
    return this;
  }
  destroy(_err?: unknown): this {
    this.destroyed = true;
    this.readyState = "closed";
    return this;
  }
  pause(): this {
    return this;
  }
  resume(): this {
    return this;
  }
  setTimeout(_ms: number, _cb?: () => void): this {
    return this;
  }
  setNoDelay(_noDelay?: boolean): this {
    return this;
  }
  setKeepAlive(_enable?: boolean, _delay?: number): this {
    return this;
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
  setEncoding(_enc?: string): this {
    return this;
  }
  pipe<T>(_dest: T): T {
    return _dest;
  }
  unpipe(_dest?: unknown): this {
    return this;
  }
}

class Server extends EventEmitter {
  listening = false;
  maxConnections = Infinity;

  private _port = 0;
  private _host = "";

  listen(
    portOrOptions: number | { port?: number; host?: string; path?: string },
    hostOrCb?: string | (() => void),
    _backlogOrCb?: number | (() => void),
    cb?: () => void,
  ): this {
    if (typeof portOrOptions === "object" && portOrOptions !== null) {
      this._port = portOrOptions.port ?? 0;
      this._host = portOrOptions.host ?? "localhost";
    } else {
      this._port = portOrOptions as number;
      this._host =
        typeof hostOrCb === "string" ? hostOrCb : "localhost";
    }
    this.listening = true;
    const callback =
      typeof cb === "function"
        ? cb
        : typeof _backlogOrCb === "function"
          ? _backlogOrCb
          : typeof hostOrCb === "function"
            ? hostOrCb
            : undefined;
    if (callback) setTimeout(callback, 0);
    setTimeout(() => this.emit("listening"), 0);
    return this;
  }

  address(): { address: string; family: string; port: number } | null {
    if (!this.listening) return null;
    return { address: this._host, family: "IPv4", port: this._port };
  }

  close(cb?: (err?: Error) => void): this {
    this.listening = false;
    if (cb) setTimeout(cb, 0);
    return this;
  }

  getConnections(cb: (err: Error | null, count: number) => void): void {
    cb(null, 0);
  }

  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
}

function createServer(
  optionsOrCb?: Record<string, unknown> | ((socket: Socket) => void),
  connectionListener?: (socket: Socket) => void,
): Server {
  const server = new Server();
  const cb =
    typeof optionsOrCb === "function" ? optionsOrCb : connectionListener;
  if (cb) server.on("connection", cb);
  return server;
}

function createConnection(
  portOrOptions: unknown,
  _hostOrCb?: unknown,
  _cb?: unknown,
): Socket {
  return new Socket();
}

function connect(
  portOrOptions: unknown,
  _hostOrCb?: unknown,
  _cb?: unknown,
): Socket {
  return new Socket();
}

function isIP(input: string): 0 | 4 | 6 {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(input)) return 4;
  if (input.includes(":")) return 6;
  return 0;
}

function isIPv4(input: string): boolean {
  return isIP(input) === 4;
}

function isIPv6(input: string): boolean {
  return isIP(input) === 6;
}

export function createNetPolyfill(): Record<string, unknown> {
  return {
    Socket,
    Server,
    createServer,
    createConnection,
    connect,
    isIP,
    isIPv4,
    isIPv6,
  };
}
