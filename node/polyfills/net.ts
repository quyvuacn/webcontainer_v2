/**
 * Node net polyfill — virtual TCP sockets for browser.
 * Real TCP is handled by the SAB-based virtual port system (js/tcp_worker.ts).
 * This module provides a compatible API surface so packages that import 'net'
 * (e.g. http internals, ws, mysql clients) do not crash.
 */

import EventEmitter from "eventemitter3";

// Type for the virtual TCP client hook injected by main.ts bootstrap.
// If available, Socket.connect() delegates to it instead of emitting ECONNREFUSED.
type VirtualConnectHook = (
  port: number,
  host: string,
  callbacks: {
    onConnect: () => void;
    onData: (chunk: Uint8Array) => void;
    onClose: () => void;
    onError: (err: Error) => void;
  },
) => Promise<{
  write: (chunk: Uint8Array) => void;
  end: () => void;
  destroy: () => void;
}>;

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
  private _handle: { write: (c: Uint8Array) => void; end: () => void; destroy: () => void } | null = null;

  address() {
    return {
      address: this.localAddress,
      family: "IPv4",
      port: this.localPort,
    };
  }

  connect(
    portOrOptions: number | { port?: number; host?: string; path?: string },
    hostOrCb?: string | (() => void),
    cb?: () => void,
  ): this {
    // Resolve port + host from overloaded args
    let port = 0;
    let host = "localhost";
    let callback: (() => void) | undefined;

    if (typeof portOrOptions === "object" && portOrOptions !== null) {
      port = portOrOptions.port ?? 0;
      host = portOrOptions.host ?? "localhost";
      callback = typeof hostOrCb === "function" ? hostOrCb : cb;
    } else {
      port = portOrOptions as number;
      if (typeof hostOrCb === "function") callback = hostOrCb;
      else if (typeof hostOrCb === "string") { host = hostOrCb; callback = cb; }
    }

    if (callback) this.once("connect", callback);

    this.connecting = true;
    this.pending = true;
    this.readyState = "opening";

    // Try virtual TCP hook first (injected by main.ts bootstrap)
    const hook = (globalThis as Record<string, unknown>).__connectVirtualPort as VirtualConnectHook | undefined;

    if (typeof hook === "function") {
      hook(port, host, {
        onConnect: () => {
          this.connecting = false;
          this.pending = false;
          this.readable = true;
          this.writable = true;
          this.readyState = "open";
          this.emit("connect");
          this.emit("ready");
        },
        onData: (chunk: Uint8Array) => {
          this.bytesRead += chunk.length;
          this.emit("data", chunk);
        },
        onClose: () => {
          this.readable = false;
          this.writable = false;
          this.readyState = "closed";
          this.emit("end");
          this.emit("close", false);
        },
        onError: (err: Error) => {
          this.connecting = false;
          this.destroyed = true;
          this.readyState = "closed";
          this.emit("error", err);
          this.emit("close", true);
        },
      })
        .then((handle) => { this._handle = handle; })
        .catch((err: Error) => {
          this.connecting = false;
          this.destroyed = true;
          this.readyState = "closed";
          this.emit("error", err);
        });
    } else {
      // No virtual TCP available — emit ECONNREFUSED so callers know
      queueMicrotask(() => {
        this.connecting = false;
        this.destroyed = true;
        this.readyState = "closed";
        const err = Object.assign(
          new Error(`connect ECONNREFUSED ${host}:${port}`),
          { code: "ECONNREFUSED", syscall: "connect", address: host, port },
        );
        this.emit("error", err);
        this.emit("close", true);
      });
    }
    return this;
  }

  write(data: string | Uint8Array, _enc?: unknown, cb?: ((err?: Error) => void) | unknown): boolean {
    const callback = typeof cb === "function" ? cb as (err?: Error) => void : undefined;
    if (!this._handle || !this.writable) {
      callback?.(new Error("write after end"));
      return false;
    }
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    this.bytesWritten += bytes.length;
    this._handle.write(bytes);
    callback?.();
    return true;
  }

  end(data?: unknown, _enc?: unknown, cb?: unknown): this {
    if (typeof data === "string" || data instanceof Uint8Array) {
      this.write(data);
    }
    this._handle?.end();
    this._handle = null;
    this.writable = false;
    this.readyState = "closed";
    if (typeof cb === "function") (cb as () => void)();
    return this;
  }

  destroy(_err?: unknown): this {
    this._handle?.destroy();
    this._handle = null;
    this.destroyed = true;
    this.readable = false;
    this.writable = false;
    this.readyState = "closed";
    return this;
  }

  pause(): this { return this; }
  resume(): this { return this; }
  setTimeout(_ms: number, _cb?: () => void): this { return this; }
  setNoDelay(_noDelay?: boolean): this { return this; }
  setKeepAlive(_enable?: boolean, _delay?: number): this { return this; }
  ref(): this { return this; }
  unref(): this { return this; }
  setEncoding(_enc?: string): this { return this; }

  pipe<T extends { write: (c: unknown) => unknown; end: () => unknown }>(dest: T): T {
    this.on("data", (chunk) => dest.write(chunk));
    this.on("end", () => dest.end());
    return dest;
  }

  unpipe(_dest?: unknown): this { return this; }
}

class Server extends EventEmitter {
  listening = false;
  maxConnections = Infinity;

  private _port = 0;
  private _host = "";

  listen(
    portOrOptions:
      | number
      | { port?: number; host?: string; path?: string; backlog?: number },
    hostOrBacklogOrCb?: string | number | (() => void),
    backlogOrCb?: number | (() => void),
    cb?: () => void,
  ): this {
    if (typeof portOrOptions === "object" && portOrOptions !== null) {
      this._port = portOrOptions.port ?? 0;
      this._host = portOrOptions.host ?? "localhost";
    } else {
      this._port = portOrOptions as number;
      if (typeof hostOrBacklogOrCb === "string") {
        this._host = hostOrBacklogOrCb;
      }
    }
    // Find the callback: last function argument
    const callback =
      typeof cb === "function"
        ? cb
        : typeof backlogOrCb === "function"
          ? backlogOrCb
          : typeof hostOrBacklogOrCb === "function"
            ? hostOrBacklogOrCb
            : undefined;
    this.listening = true;
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
  portOrOptions: number | { port?: number; host?: string },
  hostOrCb?: string | (() => void),
  cb?: () => void,
): Socket {
  const socket = new Socket();
  socket.connect(portOrOptions as number, hostOrCb as string, cb);
  return socket;
}

function connect(
  portOrOptions: number | { port?: number; host?: string },
  hostOrCb?: string | (() => void),
  cb?: () => void,
): Socket {
  return createConnection(portOrOptions, hostOrCb, cb);
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
