/**
 * Stub for node:http2 — HTTP/2. Not available in browser.
 * Returns EventEmitter-based stubs so .on()/.once() calls don't crash.
 */

import EventEmitter from "eventemitter3";
import { Buffer } from "buffer";

class Http2Session extends EventEmitter {
  destroyed = false;
  closed = false;
  connecting = false;
  type = 0;
  socket = null;
  state = {};
  close(cb?: () => void) {
    this.closed = true;
    queueMicrotask(() => { cb?.(); this.emit("close"); });
  }
  destroy(_err?: Error, _code?: number) {
    this.destroyed = true;
    this.emit("close");
  }
  goaway(_code?: number, _lastStreamID?: number, _opaqueData?: Buffer) {}
  ping(_payload?: unknown, _cb?: (err: Error | null, duration: number, payload: Buffer) => void) {}
  ref() { return this; }
  unref() { return this; }
  settings(_settings: unknown, _cb?: () => void) {}
  setTimeout(_msecs: number, _cb?: () => void) {}
  get alpnProtocol() { return "h2"; }
  get encrypted() { return false; }
  get originSet() { return []; }
  get pendingSettingsAck() { return false; }
  get remoteSettings() { return {}; }
  get localSettings() { return {}; }
}

class ServerHttp2Session extends Http2Session {
  altsvc(_alt: unknown, _originOrStream: unknown) {}
  origin(..._origins: unknown[]) {}
}

class Http2Stream extends EventEmitter {
  aborted = false;
  bufferSize = 0;
  closed = false;
  destroyed = false;
  endAfterHeaders = false;
  id = 0;
  pending = false;
  rstCode = 0;
  sentHeaders = {};
  sentInfoHeaders: unknown[] = [];
  sentTrailers = {};
  session = null;
  state = {};
  close(_code?: number, _cb?: () => void) { this.closed = true; }
  priority(_options: unknown) {}
  setTimeout(_msecs: number, _cb?: () => void) {}
}

class Http2ServerRequest extends Http2Stream {
  headers = {};
  httpVersion = "2.0";
  method = "GET";
  rawHeaders: string[] = [];
  scheme = "https";
  socket = null;
  url = "/";
  authority = "";
  complete = false;
  trailers = {};
  read() {}
  setTimeout(_ms: number, _cb?: () => void) {}
}

class Http2ServerResponse extends Http2Stream {
  finished = false;
  headersSent = false;
  sendDate = true;
  socket = null;
  statusCode = 200;
  statusMessage = "";
  setHeader(_name: string, _value: unknown) {}
  getHeader(_name: string) { return undefined; }
  getHeaderNames() { return []; }
  getHeaders() { return {}; }
  hasHeader(_name: string) { return false; }
  removeHeader(_name: string) {}
  addTrailers(_headers: unknown) {}
  flushHeaders() {}
  write(_chunk: unknown, _encoding?: unknown, _cb?: () => void) { return true; }
  end(_chunk?: unknown, _encoding?: unknown, _cb?: () => void): this { return this; }
  stream() { return new Http2Stream(); }
  writeContinue() {}
  writeEarlyHints(_hints: unknown) {}
  writeHead(_statusCode: number, _headers?: unknown): this { return this; }
  createPushResponse(_headers: unknown, _cb: unknown) {}
}

class Http2Server extends EventEmitter {
  listening = false;
  listen(...args: unknown[]): this {
    this.listening = true;
    const cb = args.find(a => typeof a === "function") as (() => void) | undefined;
    queueMicrotask(() => { cb?.(); this.emit("listening"); });
    return this;
  }
  close(cb?: () => void): this {
    this.listening = false;
    queueMicrotask(() => { cb?.(); this.emit("close"); });
    return this;
  }
  address() { return null; }
  setTimeout(_msecs: number, _cb?: () => void): this { return this; }
}

class Http2SecureServer extends Http2Server {}

export function createHttp2Polyfill(): Record<string, unknown> {
  return {
    createServer: (
      _optionsOrHandler?: unknown,
      _handler?: unknown,
    ) => new Http2Server(),
    createSecureServer: (
      _optionsOrHandler?: unknown,
      _handler?: unknown,
    ) => new Http2SecureServer(),
    connect: (
      _authority: unknown,
      _optionsOrListener?: unknown,
      _listener?: unknown,
    ) => {
      const session = new Http2Session();
      queueMicrotask(() => session.emit("connect", session, {}));
      return session;
    },
    getDefaultSettings: () => ({
      headerTableSize: 4096,
      enablePush: true,
      initialWindowSize: 65535,
      maxFrameSize: 16384,
      maxConcurrentStreams: 4294967295,
      maxHeaderListSize: 65535,
    }),
    getPackedSettings: (_settings?: unknown) => Buffer.alloc(0),
    getUnpackedSettings: (_buf?: unknown) => ({}),
    sensitiveHeaders: Symbol("sensitiveHeaders"),
    Http2Session,
    ServerHttp2Session,
    Http2Stream,
    Http2Server,
    Http2SecureServer,
    Http2ServerRequest,
    Http2ServerResponse,
    constants: {
      NGHTTP2_SESSION_SERVER: 0,
      NGHTTP2_SESSION_CLIENT: 1,
      NGHTTP2_STREAM_STATE_IDLE: 1,
      NGHTTP2_STREAM_STATE_OPEN: 2,
      NGHTTP2_STREAM_STATE_RESERVED_LOCAL: 3,
      NGHTTP2_STREAM_STATE_RESERVED_REMOTE: 4,
      NGHTTP2_STREAM_STATE_HALF_CLOSED_LOCAL: 5,
      NGHTTP2_STREAM_STATE_HALF_CLOSED_REMOTE: 6,
      NGHTTP2_STREAM_STATE_CLOSED: 7,
      NGHTTP2_NO_ERROR: 0,
      NGHTTP2_PROTOCOL_ERROR: 1,
      NGHTTP2_INTERNAL_ERROR: 2,
      NGHTTP2_FLOW_CONTROL_ERROR: 3,
      NGHTTP2_SETTINGS_TIMEOUT: 4,
      NGHTTP2_STREAM_CLOSED: 5,
      NGHTTP2_FRAME_SIZE_ERROR: 6,
      NGHTTP2_REFUSED_STREAM: 7,
      NGHTTP2_CANCEL: 8,
      NGHTTP2_COMPRESSION_ERROR: 9,
      NGHTTP2_CONNECT_ERROR: 10,
      NGHTTP2_ENHANCE_YOUR_CALM: 11,
      NGHTTP2_INADEQUATE_SECURITY: 12,
      NGHTTP2_HTTP_1_1_REQUIRED: 13,
      HTTP2_HEADER_STATUS: ":status",
      HTTP2_HEADER_METHOD: ":method",
      HTTP2_HEADER_AUTHORITY: ":authority",
      HTTP2_HEADER_SCHEME: ":scheme",
      HTTP2_HEADER_PATH: ":path",
      HTTP2_METHOD_GET: "GET",
      HTTP2_METHOD_POST: "POST",
      HTTP_STATUS_OK: 200,
      HTTP_STATUS_NOT_FOUND: 404,
      HTTP_STATUS_INTERNAL_SERVER_ERROR: 500,
    },
  };
}
