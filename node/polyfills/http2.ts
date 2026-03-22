/**
 * Stub for node:http2 — HTTP/2. Not available in browser.
 */

export function createHttp2Polyfill(): Record<string, unknown> {
  return {
    connect: () => ({}),
    createServer: () => ({}),
    createSecureServer: () => ({}),
    constants: {},
    getDefaultSettings: () => ({}),
    getPackedSettings: () => new Uint8Array(0),
    getUnpackedSettings: () => ({}),
    sensitiveHeaders: Symbol(""),
    Http2Session: class {},
    ServerHttp2Session: class {},
    Http2Stream: class {},
    Http2Server: class {},
    Http2SecureServer: class {},
  };
}
