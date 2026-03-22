/**
 * Node buffer module polyfill — uses 'buffer' package.
 * Returns module object so named exports (Buffer, Blob, etc.) resolve correctly.
 */

import { Buffer } from "buffer";

const kMaxLength = 0x7fffffff;

// Patch base64url encoding — Node.js 16+ supports it; feross/buffer does not.
if (typeof Buffer.prototype.toString === "function") {
  const _orig = Buffer.prototype.toString;
  (Buffer.prototype as { _wcPatched?: boolean })._wcPatched = true;
  Buffer.prototype.toString = function (
    encoding?: string,
    start?: number,
    end?: number,
  ): string {
    if (encoding === "base64url") {
      return (_orig.call(this, "base64", start, end) as string)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
    }
    return _orig.call(
      this,
      encoding as Parameters<typeof _orig>[0],
      start,
      end,
    );
  };
  // Patch Buffer.from to handle base64url input
  const _origFrom = Buffer.from.bind(Buffer) as typeof Buffer.from;
  (Buffer as unknown as { from: typeof Buffer.from }).from = function (
    value: unknown,
    encodingOrOffset?: unknown,
    length?: unknown,
  ): Buffer {
    if (typeof value === "string" && encodingOrOffset === "base64url") {
      const b64 = (value as string)
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil((value as string).length / 4) * 4, "=");
      return (_origFrom as (v: string, enc: string) => Buffer)(b64, "base64");
    }
    if (length !== undefined)
      return (_origFrom as (v: unknown, o: unknown, l: unknown) => Buffer)(
        value,
        encodingOrOffset,
        length,
      );
    if (encodingOrOffset !== undefined)
      return (_origFrom as (v: unknown, o: unknown) => Buffer)(
        value,
        encodingOrOffset,
      );
    return (_origFrom as (v: unknown) => Buffer)(value);
  } as typeof Buffer.from;
}

export function createBufferPolyfill() {
  return {
    Buffer,
    Blob: globalThis.Blob,
    kMaxLength,
    transcode: (src: Uint8Array, _fromEnc: string, _toEnc: string): Buffer =>
      Buffer.from(src),
    constants: { MAX_LENGTH: kMaxLength },
  };
}
