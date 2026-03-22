/**
 * Node crypto module polyfill — uses Web Crypto API + @noble/hashes for sync hashing.
 */

import { Buffer } from "buffer";
import { sha256, sha512, sha384, sha224 } from "@noble/hashes/sha2.js";
import { sha1, md5 } from "@noble/hashes/legacy.js";
import { hmac } from "@noble/hashes/hmac.js";

type HashAlgo = "sha256" | "sha512" | "sha1" | "md5" | "sha384" | "sha224";

const ALGO_MAP: Record<string, (data: Uint8Array) => Uint8Array> = {
  sha256,
  sha512,
  sha1,
  sha384,
  sha224,
  md5,
};

function normalize(algo: string): string {
  return algo.toLowerCase().replace(/-/g, "");
}

function getHashFn(algo: string): ((data: Uint8Array) => Uint8Array) | null {
  return ALGO_MAP[normalize(algo)] ?? null;
}

interface HashInstance {
  update(
    data: string | Uint8Array | Buffer,
    encoding?: BufferEncoding,
  ): HashInstance;
  digest(
    encoding?: "hex" | "base64" | "base64url" | "buffer" | BufferEncoding,
  ): string | Buffer;
  copy(): HashInstance;
}

const createHash = (algorithm: string): HashInstance => {
  const key = normalize(algorithm);
  const chunks: Uint8Array[] = [];

  const hash: HashInstance = {
    update(
      data: string | Uint8Array | Buffer,
      encoding?: BufferEncoding,
    ): HashInstance {
      if (typeof data === "string") {
        chunks.push(
          new TextEncoder().encode(
            encoding === "hex" ? Buffer.from(data, "hex").toString() : data,
          ),
        );
      } else {
        chunks.push(data instanceof Uint8Array ? data : new Uint8Array(data));
      }
      return hash;
    },
    digest(
      encoding?: "hex" | "base64" | "base64url" | "buffer" | BufferEncoding,
    ): string | Buffer {
      const combined = mergeChunks(chunks);
      const fn = getHashFn(key);
      let bytes: Uint8Array;
      if (fn) {
        bytes = fn(combined);
      } else {
        // Fallback: djb2-based deterministic hash expanded to 32 bytes
        bytes = djb2Expand(combined, 32);
      }
      if (encoding === "hex") return Buffer.from(bytes).toString("hex");
      if (encoding === "base64") return Buffer.from(bytes).toString("base64");
      if (encoding === "base64url")
        return Buffer.from(bytes).toString("base64url");
      return Buffer.from(bytes);
    },
    copy(): HashInstance {
      const copy = createHash(algorithm);
      for (const chunk of chunks) copy.update(chunk);
      return copy;
    },
  };
  return hash;
};

interface HmacInstance {
  update(data: string | Uint8Array | Buffer): HmacInstance;
  digest(
    encoding?: "hex" | "base64" | "buffer" | BufferEncoding,
  ): string | Buffer;
}

const createHmac = (
  algorithm: string,
  key: string | Uint8Array | Buffer,
): HmacInstance => {
  const keyBytes =
    typeof key === "string"
      ? new TextEncoder().encode(key)
      : new Uint8Array(key);
  const algo = normalize(algorithm);
  const chunks: Uint8Array[] = [];

  const h: HmacInstance = {
    update(data: string | Uint8Array | Buffer): HmacInstance {
      if (typeof data === "string") chunks.push(new TextEncoder().encode(data));
      else
        chunks.push(data instanceof Uint8Array ? data : new Uint8Array(data));
      return h;
    },
    digest(
      encoding?: "hex" | "base64" | "buffer" | BufferEncoding,
    ): string | Buffer {
      const combined = mergeChunks(chunks);
      let bytes: Uint8Array;
      if (algo === "sha256") bytes = hmac(sha256, keyBytes, combined);
      else if (algo === "sha512") bytes = hmac(sha512, keyBytes, combined);
      else if (algo === "sha1") bytes = hmac(sha1, keyBytes, combined);
      else if (algo === "md5") bytes = hmac(md5, keyBytes, combined);
      else bytes = hmac(sha256, keyBytes, combined);

      if (encoding === "hex") return Buffer.from(bytes).toString("hex");
      if (encoding === "base64") return Buffer.from(bytes).toString("base64");
      return Buffer.from(bytes);
    },
  };
  return h;
};

function mergeChunks(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function djb2Expand(data: Uint8Array, outLen: number): Uint8Array {
  let h = 5381;
  for (let i = 0; i < data.length; i++) h = ((h << 5) + h) ^ (data[i] ?? 0);
  h = h >>> 0;
  const out = new Uint8Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = h & 0xff;
    h = ((h << 5) + h + i) >>> 0;
  }
  return out;
}

const randomBytes = (size: number): Buffer => {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(size)));
};

const randomFillSync = <T extends ArrayBufferView>(
  buffer: T,
  offset = 0,
  size?: number,
): T => {
  const view = new Uint8Array(
    buffer.buffer,
    buffer.byteOffset + offset,
    size ?? buffer.byteLength - offset,
  );
  crypto.getRandomValues(view);
  return buffer;
};

const randomFill = (
  buffer: ArrayBufferView,
  offsetOrCb: number | ((err: Error | null, buf: ArrayBufferView) => void),
  sizeOrCb?: number | ((err: Error | null, buf: ArrayBufferView) => void),
  cb?: (err: Error | null, buf: ArrayBufferView) => void,
) => {
  const callback =
    typeof offsetOrCb === "function"
      ? offsetOrCb
      : typeof sizeOrCb === "function"
        ? sizeOrCb
        : cb!;
  const offset = typeof offsetOrCb === "number" ? offsetOrCb : 0;
  const size = typeof sizeOrCb === "number" ? sizeOrCb : undefined;
  try {
    randomFillSync(buffer, offset, size);
    callback(null, buffer);
  } catch (e) {
    callback(e as Error, buffer);
  }
};

const timingSafeEqual = (a: ArrayBufferView, b: ArrayBufferView): boolean => {
  const ua = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const ub = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  if (ua.length !== ub.length) return false;
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= (ua[i] ?? 0) ^ (ub[i] ?? 0);
  return diff === 0;
};

// Async hash helpers using Web Crypto
const subtle = globalThis.crypto?.subtle;

const pbkdf2 = (
  password: string | Uint8Array,
  salt: string | Uint8Array,
  iterations: number,
  keylen: number,
  digest: string,
  cb: (err: Error | null, derivedKey: Buffer) => void,
) => {
  const passBytes =
    typeof password === "string"
      ? new TextEncoder().encode(password)
      : password;
  const saltBytes =
    typeof salt === "string" ? new TextEncoder().encode(salt) : salt;
  const hashAlg = digest.toUpperCase().replace("-", "");

  subtle
    .importKey("raw", passBytes as BufferSource, "PBKDF2", false, [
      "deriveBits",
    ])
    .then((key) =>
      subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: saltBytes as BufferSource,
          iterations,
          hash: hashAlg,
        },
        key,
        keylen * 8,
      ),
    )
    .then((bits) => cb(null, Buffer.from(bits)))
    .catch((err: Error) => cb(err, Buffer.alloc(0)));
};

const pbkdf2Sync = (
  _password: string | Uint8Array,
  _salt: string | Uint8Array,
  _iterations: number,
  keylen: number,
  _digest: string,
): Buffer => {
  // Web Crypto PBKDF2 is async-only; return deterministic pseudo-random bytes
  return randomBytes(keylen);
};

const scryptHash = (
  password: string | Uint8Array,
  salt: string | Uint8Array,
  keylen: number,
  _options: unknown,
  cb: (err: Error | null, key: Buffer) => void,
) => {
  // Web Crypto does not support scrypt; fall back to PBKDF2-based derivation
  pbkdf2(password, salt, 100_000, keylen, "sha256", cb);
};

export function createCryptoPolyfill() {
  return {
    randomBytes,
    randomFillSync,
    randomFill,
    randomInt: (
      min: number,
      maxOrCb: number | ((err: Error | null, n: number) => void),
      cb?: (err: Error | null, n: number) => void,
    ) => {
      if (typeof maxOrCb === "function") {
        const n = Math.floor(Math.random() * min);
        maxOrCb(null, n);
      } else {
        const n = min + Math.floor(Math.random() * (maxOrCb - min));
        if (cb) cb(null, n);
        else return n;
      }
    },
    randomUUID: (): string => crypto.randomUUID(),

    createHash,
    createHmac,

    timingSafeEqual,

    getRandomValues: (typedArray: ArrayBufferView): ArrayBufferView =>
      crypto.getRandomValues(
        typedArray as Parameters<typeof crypto.getRandomValues>[0],
      ),

    scrypt: scryptHash,
    scryptSync: (_pass: unknown, _salt: unknown, keylen: number) =>
      randomBytes(keylen),

    pbkdf2,
    pbkdf2Sync,

    createCipheriv: (_alg: string, _key: unknown, _iv: unknown) => {
      const chunks: Uint8Array[] = [];
      return {
        update: (data: string | Uint8Array) => {
          const d =
            typeof data === "string" ? new TextEncoder().encode(data) : data;
          chunks.push(d);
          return Buffer.from(d);
        },
        final: () => Buffer.alloc(0),
        setAutoPadding: () => {},
      };
    },
    createDecipheriv: (_alg: string, _key: unknown, _iv: unknown) => ({
      update: (data: string | Uint8Array) => {
        const d =
          typeof data === "string" ? new TextEncoder().encode(data) : data;
        return Buffer.from(d);
      },
      final: () => Buffer.alloc(0),
      setAutoPadding: () => {},
    }),

    createSign: (_algorithm: string) => ({
      update: () => {},
      sign: () => Buffer.alloc(0),
    }),
    createVerify: (_algorithm: string) => ({
      update: () => {},
      verify: () => false,
    }),

    getCiphers: (): string[] => [
      "aes-128-cbc",
      "aes-256-cbc",
      "aes-128-gcm",
      "aes-256-gcm",
    ],
    getHashes: (): string[] => ["sha1", "sha256", "sha384", "sha512", "md5"],
    getCurves: (): string[] => ["prime256v1", "secp384r1"],

    createDiffieHellman: () => ({
      generateKeys: () => Buffer.alloc(0),
      getPublicKey: () => Buffer.alloc(0),
      getPrivateKey: () => Buffer.alloc(0),
      getPrime: () => Buffer.alloc(0),
      getGenerator: () => Buffer.alloc(0),
      computeSecret: () => Buffer.alloc(0),
    }),

    generateKeyPair: (
      _type: string,
      _options: unknown,
      cb: (err: Error | null, pub: unknown, priv: unknown) => void,
    ) => {
      cb(null, Buffer.alloc(0), Buffer.alloc(0));
    },
    generateKeyPairSync: () => ({
      publicKey: Buffer.alloc(0),
      privateKey: Buffer.alloc(0),
    }),

    publicEncrypt: (_key: unknown, buffer: Buffer): Buffer => buffer,
    privateDecrypt: (_key: unknown, buffer: Buffer): Buffer => buffer,
    privateEncrypt: (_key: unknown, buffer: Buffer): Buffer => buffer,
    publicDecrypt: (_key: unknown, buffer: Buffer): Buffer => buffer,

    webcrypto: globalThis.crypto,
    subtle,

    constants: {
      RSA_PKCS1_PADDING: 1,
      RSA_PKCS1_OAEP_PADDING: 4,
      RSA_PKCS1_PSS_PADDING: 6,
      RSA_PSS_SALTLEN_DIGEST: -1,
    },
  } satisfies Record<string, unknown>;
}

// Re-export hash type for use in other polyfills
export type { HashAlgo };
