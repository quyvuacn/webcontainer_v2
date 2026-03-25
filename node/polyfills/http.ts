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
  readable = true;

  // Body buffer: chunks pushed by whoever constructs this message (server handler
  // or ClientRequest response). Drained when the consumer calls resume() or attaches
  // a 'data' listener.
  private _bodyChunks: Buffer[] = [];
  private _bodyEnded = false;
  private _flowing = false;
  private _encoding: BufferEncoding | null = null;

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

  // Called by the server handler / ClientRequest to push body data.
  _pushChunk(chunk: Buffer | Uint8Array): void {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (this._flowing) {
      this.emit("data", this._encoding ? buf.toString(this._encoding) : buf);
    } else {
      this._bodyChunks.push(buf);
    }
  }

  // Called when all body data has been pushed.
  _endBody(): void {
    this._bodyEnded = true;
    if (this._flowing) {
      this.readable = false;
      this.emit("end");
    }
  }

  setEncoding(enc: string): this {
    this._encoding = enc as BufferEncoding;
    return this;
  }

  // Switches to flowing mode: drains any buffered chunks then emits 'end'.
  resume(): this {
    this._flowing = true;
    queueMicrotask(() => {
      for (const chunk of this._bodyChunks) {
        this.emit("data", this._encoding ? chunk.toString(this._encoding) : chunk);
      }
      this._bodyChunks = [];
      if (this._bodyEnded) {
        this.readable = false;
        this.emit("end");
      }
    });
    return this;
  }

  pause(): this {
    this._flowing = false;
    return this;
  }

  destroy(_err?: Error): this {
    this._bodyChunks = [];
    this._bodyEnded = true;
    this.readable = false;
    return this;
  }

  // Minimal pipe: attach data/end → write/end on dest stream.
  pipe<T extends { write: (c: unknown) => unknown; end: () => unknown }>(dest: T): T {
    this.on("data", (chunk) => dest.write(chunk));
    this.on("end", () => dest.end());
    this.resume();
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

  end(body?: string | Uint8Array, _enc?: unknown, cb?: () => void): this {
    if (body !== undefined && body !== null) {
      const bytes =
        typeof body === "string"
          ? new TextEncoder().encode(body)
          : new Uint8Array(body);
      this._writeBuffer.push(bytes);
    }
    this.writableEnded = true;
    this.headersSent = true;
    if (typeof cb === "function") cb();
    this.emit("finish");
    return this;
  }

  // Serialize the full response body from all write() / end() calls.
  // Used by __setupVirtualPort handler to build the HTTP response buffer.
  _getBody(): Uint8Array {
    if (this._writeBuffer.length === 0) return new Uint8Array(0);
    const total = this._writeBuffer.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const chunk of this._writeBuffer) {
      out.set(chunk, off);
      off += chunk.length;
    }
    return out;
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
        ) => (() => void) | Promise<() => void> | void)
      | undefined;

    if (this._port > 0 && this._handler && typeof setup === "function") {
      try {
        const result = setup(this._port, this._handler);
        if (
          result &&
          typeof (result as Promise<() => void>).then === "function"
        ) {
          (result as Promise<() => void>)
            .then((release: unknown) => {
              if (typeof release === "function")
                this._releaseHandle = release as () => void;
              cb?.();
              this.emit("listening");
            })
            .catch((e: unknown) => {
              this.emit("error", e);
              (cb as ((err?: Error) => void) | undefined)?.(e as Error);
              if (this.listenerCount("error") === 0 && (!cb || cb.length === 0))
                throw e;
            });
          return this;
        }
        if (typeof result === "function")
          this._releaseHandle = result as () => void;
      } catch (e) {
        this.emit("error", e);
        (cb as ((err?: Error) => void) | undefined)?.(e as Error);
        if (this.listenerCount("error") === 0 && (!cb || cb.length === 0))
          throw e;
        return this;
      }
    }
    if (this._handler && !this._releaseHandle)
      this._releaseHandle = addActiveHandle();

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
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : typeof chunk === "string"
        ? Buffer.from(chunk)
        : Buffer.from(chunk);
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
      .then((res) => {
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

        // Stream response body chunk-by-chunk instead of buffering the whole thing.
        // This lets consumers pipe large responses (file downloads, SSE) without OOM.
        const reader = res.body?.getReader();
        if (!reader) {
          msg._endBody();
          return;
        }
        const pump = (): Promise<void> =>
          reader.read().then(({ done, value }) => {
            if (done) {
              msg._endBody();
              return;
            }
            msg._pushChunk(Buffer.from(value));
            return pump();
          });
        pump().catch((err: Error) => {
          if (!this._aborted) this.emit("error", err);
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
  102: "Processing",
  103: "Early Hints",
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  207: "Multi-Status",
  208: "Already Reported",
  226: "IM Used",
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  305: "Use Proxy",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Payload Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a Teapot",
  421: "Misdirected Request",
  422: "Unprocessable Entity",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  510: "Not Extended",
  511: "Network Authentication Required",
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
    METHODS: ["ACL", "BIND", "CHECKOUT", "CONNECT", "COPY", "DELETE", "GET", "HEAD",
      "LINK", "LOCK", "M-SEARCH", "MERGE", "MKACTIVITY", "MKCALENDAR", "MKCOL",
      "MOVE", "NOTIFY", "OPTIONS", "PATCH", "POST", "PROPFIND", "PROPPATCH",
      "PURGE", "PUT", "REBIND", "REPORT", "SEARCH", "SOURCE", "SUBSCRIBE", "TRACE",
      "UNBIND", "UNLINK", "UNLOCK", "UNSUBSCRIBE"],
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
