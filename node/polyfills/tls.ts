/**
 * Stub for tls / node:tls — TLS/SSL. Not available in browser.
 */

export function createTlsPolyfill(): Record<string, unknown> {
  return {
    connect: () => ({}),
    createServer: () => ({}),
    createSecureContext: () => ({}),
    createSecurePair: () => ({}),
    TLSSocket: class {},
    Server: class {},
    rootCertificates: [],
  };
}
