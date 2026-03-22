/**
 * CDN base URL — points to the npm proxy server.
 * Override via VITE_CDN_BASE env var (default: http://localhost:4873).
 * In production: set VITE_CDN_BASE=https://your-proxy.example.com
 */
export const CDN_BASE: string =
  (typeof import.meta !== 'undefined' && (import.meta as { env?: { VITE_CDN_BASE?: string } }).env?.VITE_CDN_BASE)
    ? (import.meta as { env: { VITE_CDN_BASE: string } }).env.VITE_CDN_BASE
    : 'http://localhost:4873'
