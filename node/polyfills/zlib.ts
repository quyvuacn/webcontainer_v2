/**
 * Node zlib polyfill — uses fflate (supports sync + async + streams).
 */

import {
  gzip as fGzip,
  gunzip as fGunzip,
  gzipSync as fGzipSync,
  gunzipSync as fGunzipSync,
  deflate as fDeflate,
  inflate as fInflate,
  deflateSync as fDeflateSync,
  inflateSync as fInflateSync,
  Gzip as FGzip,
  Gunzip as FGunzip,
  Deflate as FDeflate,
  Inflate as FInflate,
} from "fflate";
import { Transform } from "readable-stream";

type Callback = (err: Error | null, result: Buffer) => void;

function toUint8(buf: Uint8Array | Buffer): Uint8Array {
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

type FflateClass = new () => {
  push(data: Uint8Array, final?: boolean): void;
  ondata: ((data: Uint8Array, final: boolean) => void) | null;
};

function makeTransform(FClass: FflateClass): InstanceType<typeof Transform> {
  const compressor = new FClass();
  const t = new Transform({
    transform(chunk: Buffer, _enc: string, cb: (err?: Error | null) => void) {
      try {
        compressor.push(toUint8(chunk));
        cb();
      } catch (e) {
        cb(e as Error);
      }
    },
    flush(cb: (err?: Error | null) => void) {
      try {
        compressor.push(new Uint8Array(0), true);
        cb();
      } catch (e) {
        cb(e as Error);
      }
    },
  });
  compressor.ondata = (data: Uint8Array, _final: boolean) => {
    t.push(Buffer.from(data));
  };
  return t;
}

function wrapAsync(
  fn: (
    data: Uint8Array,
    cb: (err: Error | null, result: Uint8Array) => void,
  ) => void,
) {
  return (buf: Uint8Array, optsOrCb?: unknown, cb?: Callback) => {
    const callback = (
      typeof optsOrCb === "function" ? optsOrCb : cb
    ) as Callback;
    fn(toUint8(buf), (err, result) => callback(err, Buffer.from(result)));
  };
}

export function createZlibPolyfill(): Record<string, unknown> {
  return {
    gzip: wrapAsync(fGzip),
    gunzip: wrapAsync(fGunzip),
    deflate: wrapAsync(fDeflate),
    inflate: wrapAsync(fInflate),

    gzipSync: (buf: Uint8Array) => Buffer.from(fGzipSync(toUint8(buf))),
    gunzipSync: (buf: Uint8Array) => Buffer.from(fGunzipSync(toUint8(buf))),
    deflateSync: (buf: Uint8Array) => Buffer.from(fDeflateSync(toUint8(buf))),
    inflateSync: (buf: Uint8Array) => Buffer.from(fInflateSync(toUint8(buf))),

    createGzip: () => makeTransform(FGzip as unknown as FflateClass),
    createGunzip: () => makeTransform(FGunzip as unknown as FflateClass),
    createDeflate: () => makeTransform(FDeflate as unknown as FflateClass),
    createInflate: () => makeTransform(FInflate as unknown as FflateClass),

    constants: {
      Z_NO_FLUSH: 0,
      Z_PARTIAL_FLUSH: 1,
      Z_SYNC_FLUSH: 2,
      Z_FULL_FLUSH: 3,
      Z_FINISH: 4,
      Z_BLOCK: 5,
      Z_OK: 0,
      Z_STREAM_END: 1,
      Z_NEED_DICT: 2,
      Z_DEFAULT_COMPRESSION: -1,
      Z_DEFAULT_STRATEGY: 0,
    },
  };
}
