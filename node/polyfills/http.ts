/**
 * Node http/https module polyfill — createServer hooks into Virtual TCP.
 *
 * When running in browser:
 *   server.listen(port) → calls globalThis.__setupVirtualPort(port, handler)
 *   which registers the port with the Service Worker SAB pipe (see main.js).
 *
 * Fallback (test / non-browser): emits 'listening' only, no real network.
 */

import EventEmitter from "eventemitter3";
import { Buffer } from "buffer";
import { addActiveHandle } from "./active-handles";

// ── IncomingMessage ────────────────────────────────────────────────────────────

export class IncomingMessage extends EventEmitter {
  headers: Record<string, string> = {};
  rawHeaders: string[] = [];
  method = "GET";
  url = "/";
  statusCode = 200;
  statusMessage = "OK";
  httpVersion = "1.1";
  httpVersionMajor = 1;
  httpVersionMinor = 1;
  trailers: Record<string, string> = {};
  socket = { remoteAddress: "127.0.0.1", remotePort: 0, encrypted: false };
  connection = this.socket;

  constructor(
    opts?: Partial<
      Pick<
        IncomingMessage,
        "headers" | "method" | "url" | "statusCode" | "statusMessage"
      >
    >,
  ) {
    super();
    if (opts) Object.assign(this, opts);
  }

  setEncoding(_enc: string): this {
    return this;
  }
  resume(): this {
    this.emit("end");
    return this;
  }
  pause(): this {
    return this;
  }
  destroy(_err?: Error): this {
    return this;
  }
  pipe<T>(dest: T): T {
    return dest;
  }
}

// ── ServerResponse ─────────────────────────────────────────────────────────────

export class ServerResponse extends EventEmitter {
  statusCode = 200;
  statusMessage = "OK";
  headersSent = false;
  writableEnded = false;
  private _headers: Record<string, string> = {};
  _writeBuffer: Uint8Array[] = [];

  setHeader(name: string, value: string | number | string[]): this {
    this._headers[name.toLowerCase()] = Array.isArray(value)
      ? value.join(", ")
      : String(value);
    return this;
  }
  getHeader(name: string): string | undefined {
    return this._headers[name.toLowerCase()];
  }
  getHeaderNames(): string[] {
    return Object.keys(this._headers);
  }
  getHeaders(): Record<string, string> {
    return { ...this._headers };
  }
  hasHeader(name: string): boolean {
    return name.toLowerCase() in this._headers;
  }
  removeHeader(name: string): void {
    delete this._headers[name.toLowerCase()];
  }
  flushHeaders(): void {
    this.headersSent = true;
  }

  writeHead(
    code: number,
    msgOrHdrs?: string | Record<string, string>,
    hdrs?: Record<string, string>,
  ): this {
    this.statusCode = code;
    if (typeof msgOrHdrs === "string") this.statusMessage = msgOrHdrs;
    else if (msgOrHdrs) Object.assign(this._headers, msgOrHdrs);
    if (hdrs) Object.assign(this._headers, hdrs);
    this.headersSent = true;
    return this;
  }

  write(
    chunk: string | Uint8Array,
    _enc?: unknown,
    cb?: (err?: Error) => void,
  ): boolean {
    const bytes =
      typeof chunk === "string"
        ? new TextEncoder().encode(chunk)
        : new Uint8Array(chunk);
    this._writeBuffer.push(bytes);
    if (typeof cb === "function") cb();
    return true;
  }

  end(_body?: string | Uint8Array, _enc?: unknown, cb?: () => void): this {
    this.writableEnded = true;
    if (typeof cb === "function") cb();
    this.emit("finish");
    return this;
  }
}

// ── HttpServer ─────────────────────────────────────────────────────────────────

export class HttpServer extends EventEmitter {
  private _handler?: (req: IncomingMessage, res: ServerResponse) => void;
  private _port = 0;
  private _host = "127.0.0.1";
  private _releaseHandle?: () => void;
  timeout = 0;
  keepAliveTimeout = 5000;

  constructor(handler?: (req: IncomingMessage, res: ServerResponse) => void) {
    super();
    this._handler = handler;
  }

  listen(
    port?: number | { port?: number; host?: string },
    hostnameOrCb?: string | (() => void),
    cb?: () => void,
  ): this {
    if (typeof port === "object" && port !== null) {
      this._port = port.port ?? 0;
      this._host = port.host ?? "127.0.0.1";
      if (typeof hostnameOrCb === "function") cb = hostnameOrCb;
    } else {
      this._port = (port as number) ?? 0;
      if (typeof hostnameOrCb === "function") cb = hostnameOrCb;
      else if (typeof hostnameOrCb === "string") this._host = hostnameOrCb;
    }

    // ── Virtual TCP hook ──────────────────────────────────────────────────────
    // globalThis.__setupVirtualPort is injected by main.js bootstrap.
    // It registers the port with the SW SAB pipe so browser requests to
    // port-<N>.preview.yourdomain.com are routed to this handler.
    const setup = (globalThis as Record<string, unknown>).__setupVirtualPort as
      | ((
          port: number,
          handler: (req: IncomingMessage, res: ServerResponse) => void,
        ) => (() => void) | void)
      | undefined;

    if (this._port > 0 && this._handler && typeof setup === "function") {
      try {
        const release = setup(this._port, this._handler);
        if (typeof release === "function") this._releaseHandle = release;
      } catch (e) {
        console.warn(
          `[http] Virtual TCP setup for port ${this._port} failed:`,
          e,
        );
      }
    }
    if (this._handler && !this._releaseHandle) this._releaseHandle = addActiveHandle();

    queueMicrotask(() => {
      cb?.();
      this.emit("listening");
    });
    return this;
  }

  address(): { address: string; family: string; port: number } | null {
    return { address: this._host, family: "IPv4", port: this._port };
  }

  close(cb?: (err?: Error) => void): this {
    this._releaseHandle?.();
    this._releaseHandle = undefined;
    queueMicrotask(() => {
      cb?.();
      this.emit("close");
    });
    return this;
  }

  setTimeout(msecs: number, cb?: () => void): this {
    this.timeout = msecs;
    if (cb) this.once("timeout", cb);
    return this;
  }
}

// ── ClientRequest (fetch-based) ────────────────────────────────────────────────

type ReqOptions = {
  protocol?: string;
  hostname?: string;
  host?: string;
  port?: number | string;
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  timeout?: number;
};

class ClientRequest extends EventEmitter {
  private _chunks: Buffer[] = [];
  private _aborted = false;
  private _ctl = new AbortController();
  private _opts: ReqOptions;
  private _onRes?: (res: IncomingMessage) => void;

  constructor(
    opts: ReqOptions | string,
    onRes?: (res: IncomingMessage) => void,
  ) {
    super();
    this._opts = typeof opts === "string" ? { path: opts } : opts;
    this._onRes = onRes;
  }

  write(chunk: string | Uint8Array, _enc?: string, cb?: () => void): boolean {
    const buf =
      Buffer.isBuffer(chunk) ? chunk :
      typeof chunk === "string" ? Buffer.from(chunk) :
      Buffer.from(chunk);
    this._chunks.push(buf);
    cb?.();
    return true;
  }

  end(chunk?: string | Uint8Array, _enc?: string, cb?: () => void): this {
    if (chunk) this.write(chunk);
    cb?.();
    this._send();
    return this;
  }

  abort(): void {
    this._aborted = true;
    this._ctl.abort();
  }
  destroy(_e?: Error): this {
    this.abort();
    return this;
  }

  setTimeout(ms: number, cb?: () => void): this {
    if (cb) this.once("timeout", cb);
    setTimeout(() => this.emit("timeout"), ms);
    return this;
  }

  setHeader(n: string, v: string): this {
    if (!this._opts.headers) this._opts.headers = {};
    this._opts.headers[n] = v;
    return this;
  }
  getHeader(n: string) {
    return this._opts.headers?.[n];
  }
  removeHeader(n: string) {
    if (this._opts.headers) delete this._opts.headers[n];
  }

  private _send(): void {
    const o = this._opts;
    const proto = (o.protocol ?? "http:").replace(/:$/, "");
    const host = o.hostname ?? o.host ?? "localhost";
    const url = `${proto}://${host}${o.port ? ":" + o.port : ""}${o.path ?? "/"}`;
    const body =
      this._chunks.length > 0 ? Buffer.concat(this._chunks) : undefined;

    fetch(url, {
      method: o.method ?? "GET",
      headers: o.headers ?? {},
      body: body?.length ? body : undefined,
      signal: this._ctl.signal,
    })
      .then(async (res) => {
        const msg = new IncomingMessage({
          statusCode: res.status,
          statusMessage: res.statusText,
          headers: Object.fromEntries(res.headers.entries()),
          method: o.method ?? "GET",
          url,
        });
        msg.rawHeaders = [...res.headers.entries()].flat();
        this._onRes?.(msg);
        this.emit("response", msg);
        const buf = Buffer.from(await res.arrayBuffer());
        queueMicrotask(() => {
          msg.emit("data", buf);
          msg.emit("end");
        });
      })
      .catch((err: Error) => {
        if (!this._aborted) this.emit("error", err);
      });
  }
}

// ── STATUS_CODES ───────────────────────────────────────────────────────────────

const STATUS_CODES: Record<number, string> = {
  100: "Continue",
  101: "Switching Protocols",
  200: "OK",
  201: "Created",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  304: "Not Modified",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

function makeRequest(
  urlOrOpts: string | ReqOptions,
  optsOrCb?: ReqOptions | ((res: IncomingMessage) => void),
  cb?: (res: IncomingMessage) => void,
): ClientRequest {
  let opts: ReqOptions;
  let callback: ((res: IncomingMessage) => void) | undefined;

  if (typeof urlOrOpts === "string") {
    try {
      const u = new URL(urlOrOpts);
      opts = {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || undefined,
        path: u.pathname + u.search,
      };
    } catch {
      opts = { path: urlOrOpts };
    }
    callback = typeof optsOrCb === "function" ? optsOrCb : cb;
  } else {
    opts = urlOrOpts;
    callback = typeof optsOrCb === "function" ? optsOrCb : cb;
  }
  const req = new ClientRequest(opts, callback);
  if (callback) req.on("response", callback);
  return req;
}

export function createHttpPolyfill() {
  return {
    createServer: (h?: (req: IncomingMessage, res: ServerResponse) => void) =>
      new HttpServer(h),
    request: makeRequest,
    get: (
      u: string | ReqOptions,
      o?: ReqOptions | ((res: IncomingMessage) => void),
      c?: (res: IncomingMessage) => void,
    ) => {
      const req = makeRequest(u, o, c);
      req.end();
      return req;
    },
    STATUS_CODES,
    METHODS: ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"],
    IncomingMessage,
    ServerResponse,
    Server: HttpServer,
    ClientRequest,
    Agent: class Agent {
      maxSockets = 256;
      keepAlive = false;
      destroy() {}
    },
    globalAgent: { maxSockets: 256, keepAlive: false, destroy() {} },
  };
}

export function createHttpsPolyfill() {
  return { ...createHttpPolyfill() };
}
