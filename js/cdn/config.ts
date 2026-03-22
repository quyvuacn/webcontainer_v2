/**
 * CDN base URL — points to the npm proxy server.
 * Default: '/pkg' (proxied through Vite dev server at the same origin, bypassing COEP/CORS).
 * In production: set VITE_CDN_BASE=https://your-proxy.example.com
 */
export const CDN_BASE: string =
  typeof import.meta !== "undefined" &&
  (import.meta as { env?: { VITE_CDN_BASE?: string } }).env?.VITE_CDN_BASE
    ? (import.meta as { env: { VITE_CDN_BASE: string } }).env.VITE_CDN_BASE
    : "/pkg";
