/**
 * Node http/https module polyfill — createServer stub + fetch-based request/get.
 */

import EventEmitter from 'eventemitter3'
import { Buffer } from 'buffer'

// ── IncomingMessage ───────────────────────────────────────────────────────────

export class IncomingMessage extends EventEmitter {
  headers: Record<string, string> = {}
  rawHeaders: string[] = []
  method = 'GET'
  url = '/'
  statusCode = 200
  statusMessage = 'OK'
  httpVersion = '1.1'
  httpVersionMajor = 1
  httpVersionMinor = 1
  trailers: Record<string, string> = {}
  socket = { remoteAddress: '127.0.0.1', remotePort: 0, encrypted: false }
  connection = this.socket

  constructor(opts?: Partial<Pick<IncomingMessage, 'headers' | 'method' | 'url' | 'statusCode' | 'statusMessage'>>) {
    super()
    if (opts) Object.assign(this, opts)
  }

  setEncoding(_enc: string): this { return this }
  resume(): this { this.emit('end'); return this }
  pause(): this { return this }
  destroy(_err?: Error): this { return this }
  pipe<T>(dest: T): T { return dest }
}

// ── ServerResponse ────────────────────────────────────────────────────────────

export class ServerResponse extends EventEmitter {
  statusCode = 200
  statusMessage = 'OK'
  headersSent = false
  writableEnded = false
  private _headers: Record<string, string> = {}

  setHeader(name: string, value: string | number | string[]): this {
    this._headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value)
    return this
  }

  getHeader(name: string): string | undefined {
    return this._headers[name.toLowerCase()]
  }

  getHeaderNames(): string[] { return Object.keys(this._headers) }

  getHeaders(): Record<string, string> { return { ...this._headers } }

  hasHeader(name: string): boolean { return name.toLowerCase() in this._headers }

  removeHeader(name: string): void { delete this._headers[name.toLowerCase()] }

  flushHeaders(): void { this.headersSent = true }

  writeHead(statusCode: number, statusMessageOrHeaders?: string | Record<string, string>, headers?: Record<string, string>): this {
    this.statusCode = statusCode
    if (typeof statusMessageOrHeaders === 'string') this.statusMessage = statusMessageOrHeaders
    else if (statusMessageOrHeaders) Object.assign(this._headers, statusMessageOrHeaders)
    if (headers) Object.assign(this._headers, headers)
    this.headersSent = true
    return this
  }

  write(chunk: string | Uint8Array, _encoding?: unknown, cb?: (err?: Error) => void): boolean {
    if (typeof cb === 'function') cb()
    return true
  }

  end(body?: string | Uint8Array, _encoding?: unknown, cb?: () => void): this {
    this.writableEnded = true
    if (typeof cb === 'function') cb()
    this.emit('finish')
    return this
  }
}

// ── HttpServer ────────────────────────────────────────────────────────────────

export class HttpServer extends EventEmitter {
  private handler?: (req: IncomingMessage, res: ServerResponse) => void
  private _port = 0
  private _host = '127.0.0.1'
  timeout = 0
  keepAliveTimeout = 5000

  constructor(handler?: (req: IncomingMessage, res: ServerResponse) => void) {
    super()
    this.handler = handler
  }

  listen(
    port?: number | { port?: number; host?: string; path?: string },
    hostnameOrCb?: string | (() => void),
    cb?: () => void,
  ): this {
    if (typeof port === 'object' && port !== null) {
      this._port = port.port ?? 0
      this._host = port.host ?? '127.0.0.1'
      if (typeof hostnameOrCb === 'function') cb = hostnameOrCb
    } else {
      this._port = (port as number) ?? 0
      if (typeof hostnameOrCb === 'function') cb = hostnameOrCb
      else if (typeof hostnameOrCb === 'string') this._host = hostnameOrCb
    }
    queueMicrotask(() => {
      cb?.()
      this.emit('listening')
    })
    return this
  }

  address(): { address: string; family: string; port: number } | null {
    return { address: this._host, family: 'IPv4', port: this._port }
  }

  close(cb?: (err?: Error) => void): this {
    queueMicrotask(() => { cb?.(); this.emit('close') })
    return this
  }

  setTimeout(msecs: number, cb?: () => void): this {
    this.timeout = msecs
    if (cb) this.once('timeout', cb)
    return this
  }
}

// ── ClientRequest (fetch-based) ───────────────────────────────────────────────

type ReqOptions = {
  protocol?: string
  hostname?: string
  host?: string
  port?: number | string
  path?: string
  method?: string
  headers?: Record<string, string>
  timeout?: number
}

class ClientRequest extends EventEmitter {
  private _chunks: Buffer[] = []
  private _ended = false
  private _aborted = false
  private _controller = new AbortController()
  private _opts: ReqOptions
  private _onResponse?: (res: IncomingMessage) => void

  constructor(opts: ReqOptions | string, onResponse?: (res: IncomingMessage) => void) {
    super()
    this._opts = typeof opts === 'string' ? { path: opts } : opts
    this._onResponse = onResponse
  }

  write(chunk: string | Uint8Array, _enc?: string, cb?: () => void): boolean {
    this._chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    cb?.()
    return true
  }

  end(chunk?: string | Uint8Array, _enc?: string, cb?: () => void): this {
    if (chunk) this.write(chunk)
    cb?.()
    this._ended = true
    this._send()
    return this
  }

  abort(): void {
    this._aborted = true
    this._controller.abort()
  }

  destroy(_err?: Error): this {
    this.abort()
    return this
  }

  setTimeout(ms: number, cb?: () => void): this {
    if (cb) this.once('timeout', cb)
    setTimeout(() => this.emit('timeout'), ms)
    return this
  }

  setHeader(name: string, value: string): this {
    if (!this._opts.headers) this._opts.headers = {}
    this._opts.headers[name] = value
    return this
  }

  getHeader(name: string): string | undefined {
    return this._opts.headers?.[name]
  }

  removeHeader(name: string): void {
    if (this._opts.headers) delete this._opts.headers[name]
  }

  private _send(): void {
    const o = this._opts
    const protocol = (o.protocol ?? 'http:').replace(/:$/, '')
    const host = o.hostname ?? o.host ?? 'localhost'
    const port = o.port ? `:${o.port}` : ''
    const path = o.path ?? '/'
    const url = `${protocol}://${host}${port}${path}`
    const method = o.method ?? 'GET'
    const body = this._chunks.length > 0 ? Buffer.concat(this._chunks) : undefined
    const headers = o.headers ?? {}

    fetch(url, {
      method,
      headers,
      body: body?.length ? body : undefined,
      signal: this._controller.signal,
    }).then(async (res) => {
      const msg = new IncomingMessage({
        statusCode: res.status,
        statusMessage: res.statusText,
        headers: Object.fromEntries(res.headers.entries()),
        method,
        url,
      })
      msg.rawHeaders = [...res.headers.entries()].flat()
      this._onResponse?.(msg)
      this.emit('response', msg)

      const bytes = await res.arrayBuffer()
      const buf = Buffer.from(bytes)
      queueMicrotask(() => {
        msg.emit('data', buf)
        msg.emit('end')
      })
    }).catch((err: Error) => {
      if (!this._aborted) this.emit('error', err)
    })
  }
}

// ── STATUS_CODES ──────────────────────────────────────────────────────────────

const STATUS_CODES: Record<number, string> = {
  100: 'Continue', 101: 'Switching Protocols', 102: 'Processing',
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
  206: 'Partial Content', 207: 'Multi-Status', 208: 'Already Reported',
  301: 'Moved Permanently', 302: 'Found', 303: 'See Other',
  304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
  400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required',
  403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed',
  406: 'Not Acceptable', 408: 'Request Timeout', 409: 'Conflict',
  410: 'Gone', 411: 'Length Required', 413: 'Payload Too Large',
  414: 'URI Too Long', 415: 'Unsupported Media Type', 422: 'Unprocessable Entity',
  429: 'Too Many Requests', 431: 'Request Header Fields Too Large',
  500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway',
  503: 'Service Unavailable', 504: 'Gateway Timeout',
}

// ── Exports ───────────────────────────────────────────────────────────────────

function makeRequest(
  urlOrOpts: string | ReqOptions,
  optsOrCb?: ReqOptions | ((res: IncomingMessage) => void),
  cb?: (res: IncomingMessage) => void,
): ClientRequest {
  let opts: ReqOptions
  let callback: ((res: IncomingMessage) => void) | undefined

  if (typeof urlOrOpts === 'string') {
    try {
      const u = new URL(urlOrOpts)
      opts = { protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search }
    } catch {
      opts = { path: urlOrOpts }
    }
    callback = typeof optsOrCb === 'function' ? optsOrCb : cb
  } else {
    opts = urlOrOpts
    callback = typeof optsOrCb === 'function' ? optsOrCb : cb
  }

  const req = new ClientRequest(opts, callback)
  if (callback) req.on('response', callback)
  return req
}

function makeGet(
  urlOrOpts: string | ReqOptions,
  optsOrCb?: ReqOptions | ((res: IncomingMessage) => void),
  cb?: (res: IncomingMessage) => void,
): ClientRequest {
  const req = makeRequest(urlOrOpts, optsOrCb, cb)
  req.end()
  return req
}

export function createHttpPolyfill() {
  return {
    createServer: (handler?: (req: IncomingMessage, res: ServerResponse) => void) =>
      new HttpServer(handler),

    request: makeRequest,
    get: makeGet,

    STATUS_CODES,
    METHODS: ['ACL', 'BIND', 'CHECKOUT', 'CONNECT', 'COPY', 'DELETE', 'GET', 'HEAD',
              'LINK', 'LOCK', 'M-SEARCH', 'MERGE', 'MKACTIVITY', 'MKCALENDAR', 'MKCOL',
              'MOVE', 'NOTIFY', 'OPTIONS', 'PATCH', 'POST', 'PROPFIND', 'PROPPATCH',
              'PURGE', 'PUT', 'REBIND', 'REPORT', 'SEARCH', 'SOURCE', 'SUBSCRIBE',
              'TRACE', 'UNBIND', 'UNLINK', 'UNLOCK', 'UNSUBSCRIBE'],

    IncomingMessage,
    ServerResponse,
    Server: HttpServer,
    ClientRequest,

    Agent: class Agent {
      maxSockets = 256
      maxTotalSockets = Infinity
      maxFreeSockets = 256
      requests: Record<string, unknown> = {}
      sockets: Record<string, unknown> = {}
      freeSockets: Record<string, unknown> = {}
      keepAlive = false
      destroy(): void {}
    },
    globalAgent: {
      maxSockets: 256,
      maxTotalSockets: Infinity,
      maxFreeSockets: 256,
      keepAlive: false,
      requests: {},
      sockets: {},
      freeSockets: {},
      destroy(): void {},
    },
  }
}

export function createHttpsPolyfill() {
  return {
    ...createHttpPolyfill(),
    createServer: (handler?: (req: IncomingMessage, res: ServerResponse) => void) =>
      new HttpServer(handler),
  }
}
