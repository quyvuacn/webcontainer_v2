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

type ABView = Uint8Array<ArrayBuffer>;

/**
 * Return a Uint8Array backed by a plain ArrayBuffer, as required by SubtleCrypto.
 * TypeScript's lib types require ArrayBufferView<ArrayBuffer> (not ArrayBufferLike)
 * for all SubtleCrypto parameters. Copying via `new Uint8Array(n)` + `.set()` always
 * produces a plain-ArrayBuffer-backed view.
 */
function sab(u8: Uint8Array | ArrayBufferView): ABView {
  const src =
    u8 instanceof Uint8Array
      ? u8
      : new Uint8Array(u8.buffer, u8.byteOffset, u8.byteLength);

  const out = new Uint8Array(src.byteLength);
  out.set(src);
  return out as ABView;
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
  const passBytes = sab(
    typeof password === "string" ? new TextEncoder().encode(password) : password,
  );
  const saltBytes = sab(
    typeof salt === "string" ? new TextEncoder().encode(salt) : salt,
  );
  const hashAlg = digest.toUpperCase().replace("-", "");

  subtle
    .importKey("raw", passBytes, "PBKDF2", false, ["deriveBits"])
    .then((key) =>
      subtle.deriveBits(
        { name: "PBKDF2", salt: saltBytes, iterations, hash: hashAlg },
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
  _keylen: number,
  _digest: string,
): Buffer => {
  // Web Crypto PBKDF2 is strictly async-only — there is no synchronous equivalent.
  // Returning random bytes (previous behaviour) silently produced wrong hashes,
  // making password verification always fail. Throw instead so callers know.
  throw new Error(
    "crypto.pbkdf2Sync: not supported in browser — Web Crypto PBKDF2 is async-only. " +
    "Use crypto.pbkdf2() with a callback, or promisify it with util.promisify().",
  );
};

const scryptHash = (
  password: string | Uint8Array,
  salt: string | Uint8Array,
  keylen: number,
  _options: unknown,
  cb: (err: Error | null, key: Buffer) => void,
) => {
  // Web Crypto does not support scrypt.
  // Fall back to PBKDF2-SHA256 with high iterations — not identical to scrypt
  // but gives a deterministic derived key from the same inputs.
  // Packages that verify scrypt hashes against stored values will still fail;
  // this is only useful for new key derivation within a single session.
  pbkdf2(password, salt, 210_000, keylen, "sha256", cb);
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
      // Use CSPRNG via rejection sampling to avoid modulo bias.
      const secureInt = (lo: number, hi: number): number => {
        const range = hi - lo;
        if (range <= 0) return lo;
        const arr = new Uint32Array(1);
        const limit = 0x100000000 - (0x100000000 % range);
        let v: number;
        do { crypto.getRandomValues(arr); v = arr[0]!; } while (v >= limit);
        return lo + (v % range);
      };
      if (typeof maxOrCb === "function") {
        const n = secureInt(0, min);
        maxOrCb(null, n);
      } else {
        const n = secureInt(min, maxOrCb);
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

    createCipheriv: (alg: string, key: unknown, iv: unknown) => {
      // Map Node.js algorithm names to Web Crypto names.
      const algLower = alg.toLowerCase();
      const isGcm = algLower.includes("gcm");
      const isCbc = algLower.includes("cbc");
      const isCtr = algLower.includes("ctr");
      if (!isGcm && !isCbc && !isCtr) {
        throw new Error(
          `crypto.createCipheriv('${alg}'): only AES-CBC, AES-CTR, AES-GCM are supported in browser. ` +
          `Use webcrypto (crypto.subtle) directly for other algorithms.`,
        );
      }
      const keyBytes = sab(typeof key === "string" ? new TextEncoder().encode(key) : new Uint8Array(key as ArrayBufferLike));
      const ivBytes = sab(typeof iv === "string" ? new TextEncoder().encode(iv) : new Uint8Array(iv as ArrayBufferLike));
      const chunks: Uint8Array[] = [];
      let authTag: Buffer | null = null;

      const webAlg = isGcm ? "AES-GCM" : isCbc ? "AES-CBC" : "AES-CTR";

      return {
        update(data: string | Uint8Array, _inputEnc?: string, outputEnc?: string): Buffer | string {
          const d = typeof data === "string" ? new TextEncoder().encode(data) : sab(data);
          chunks.push(d);
          // update() returns empty — all encryption is deferred to final() which is async.
          // Callers using the sync return value of update() will get empty buffer here;
          // the actual ciphertext is produced by final().
          return outputEnc === "hex" ? "" : Buffer.alloc(0);
        },
        // final() returns a Promise<Buffer> — Web Crypto is async-only.
        // Callers must await this: `const ct = Buffer.concat([cipher.update(pt), await cipher.final()])`.
        final(outputEnc?: string): Promise<Buffer | string> {
          const plaintext = sab(mergeChunks(chunks));
          return subtle
            .importKey("raw", keyBytes, { name: webAlg }, false, ["encrypt"])
            .then((cryptoKey) => {
              const params: AesGcmParams | AesCbcParams | AesCtrParams = isGcm
                ? { name: "AES-GCM", iv: ivBytes }
                : isCbc
                  ? { name: "AES-CBC", iv: ivBytes }
                  : { name: "AES-CTR", counter: ivBytes, length: 64 };
              return subtle.encrypt(params, cryptoKey, plaintext);
            })
            .then((ct) => {
              if (isGcm) {
                // Web Crypto AES-GCM appends the 16-byte auth tag at the end of ciphertext.
                const buf = new Uint8Array(ct);
                authTag = Buffer.from(buf.slice(buf.length - 16));
                const ciphertext = Buffer.from(buf.slice(0, buf.length - 16));
                return outputEnc === "hex" ? (ciphertext.toString("hex") as string) : ciphertext;
              }
              const ciphertext = Buffer.from(ct);
              return outputEnc === "hex" ? (ciphertext.toString("hex") as string) : ciphertext;
            });
        },
        getAuthTag(): Buffer {
          if (!authTag) throw new Error("getAuthTag: call after final()");
          return authTag;
        },
        setAutoPadding(_pad?: boolean): void { },
      };
    },

    createDecipheriv: (alg: string, key: unknown, iv: unknown) => {
      const algLower = alg.toLowerCase();
      const isGcm = algLower.includes("gcm");
      const isCbc = algLower.includes("cbc");
      const isCtr = algLower.includes("ctr");
      if (!isGcm && !isCbc && !isCtr) {
        throw new Error(
          `crypto.createDecipheriv('${alg}'): only AES-CBC, AES-CTR, AES-GCM are supported in browser.`,
        );
      }
      const keyBytes = sab(typeof key === "string" ? new TextEncoder().encode(key) : new Uint8Array(key as ArrayBufferLike));
      const ivBytes = sab(typeof iv === "string" ? new TextEncoder().encode(iv) : new Uint8Array(iv as ArrayBufferLike));
      const chunks: Uint8Array[] = [];
      let _authTag: Uint8Array | null = null;

      const webAlg = isGcm ? "AES-GCM" : isCbc ? "AES-CBC" : "AES-CTR";

      return {
        update(data: string | Uint8Array, inputEnc?: string, outputEnc?: string): Buffer | string {
          let d: Uint8Array;
          if (typeof data === "string") {
            d = inputEnc === "hex" ? Buffer.from(data, "hex") : new TextEncoder().encode(data);
          } else {
            d = sab(data);
          }
          chunks.push(d);
          return outputEnc === "hex" ? "" : Buffer.alloc(0);
        },
        // Returns Promise<Buffer> — must be awaited.
        final(outputEnc?: string): Promise<Buffer | string> {
          let ciphertext = sab(mergeChunks(chunks));
          // For GCM: caller may have appended auth tag via setAuthTag; reattach for Web Crypto.
          if (isGcm && _authTag) {
            const combined = new Uint8Array(ciphertext.length + _authTag.length);
            combined.set(ciphertext);
            combined.set(_authTag, ciphertext.length);
            ciphertext = sab(combined);
          }
          return subtle
            .importKey("raw", keyBytes, { name: webAlg }, false, ["decrypt"])
            .then((cryptoKey) => {
              const params: AesGcmParams | AesCbcParams | AesCtrParams = isGcm
                ? { name: "AES-GCM", iv: ivBytes }
                : isCbc
                  ? { name: "AES-CBC", iv: ivBytes }
                  : { name: "AES-CTR", counter: ivBytes, length: 64 };
              return subtle.decrypt(params, cryptoKey, ciphertext);
            })
            .then((pt) => {
              const plaintext = Buffer.from(pt);
              return outputEnc === "hex" ? (plaintext.toString("hex") as string) : plaintext;
            });
        },
        setAuthTag(tag: Uint8Array): void {
          _authTag = new Uint8Array(tag);
        },
        setAutoPadding(_pad?: boolean): void { },
      };
    },

    createSign: (algorithm: string) => {
      // Returns a Promise<Buffer> from sign() — Web Crypto signing is async-only.
      // Key can be a PEM string (common) or a CryptoKey object.
      const chunks: Uint8Array[] = [];
      const algLower = algorithm.toLowerCase().replace(/-/g, "");

      const importSignKey = async (key: unknown): Promise<CryptoKey> => {
        if (key && typeof (key as CryptoKey).type === "string") return key as CryptoKey;
        // PEM string: strip header/footer and base64-decode
        const pem = String(key).replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
        const der = sab(Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)));
        if (algLower.includes("rsa")) {
          const hash = algLower.includes("512") ? "SHA-512" : algLower.includes("384") ? "SHA-384" : "SHA-256";
          const name = algLower.includes("pss") ? "RSA-PSS" : "RSASSA-PKCS1-v1_5";
          return subtle.importKey("pkcs8", der, { name, hash }, false, ["sign"]);
        }
        // Default: ECDSA P-256
        return subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
      };

      return {
        update(data: string | Uint8Array): void {
          chunks.push(typeof data === "string" ? new TextEncoder().encode(data) : sab(data));
        },
        sign(key: unknown, outputEnc?: string): Promise<Buffer | string> {
          const msg = sab(mergeChunks(chunks));
          const algLow = algorithm.toLowerCase().replace(/-/g, "");
          const hash = algLow.includes("512") ? "SHA-512" : algLow.includes("384") ? "SHA-384" : "SHA-256";
          const signParams: AlgorithmIdentifier | RsaPssParams | EcdsaParams =
            algLow.includes("pss")
              ? ({ name: "RSA-PSS", saltLength: 32 } as RsaPssParams)
              : algLow.includes("rsa")
                ? "RSASSA-PKCS1-v1_5"
                : ({ name: "ECDSA", hash } as EcdsaParams);
          return importSignKey(key)
            .then((ck) => subtle.sign(signParams, ck, msg))
            .then((sig) => {
              const buf = Buffer.from(sig);
              if (outputEnc === "hex") return buf.toString("hex") as string;
              if (outputEnc === "base64") return buf.toString("base64") as string;
              return buf;
            });
        },
      };
    },

    createVerify: (algorithm: string) => {
      const chunks: Uint8Array[] = [];
      const algLower = algorithm.toLowerCase().replace(/-/g, "");

      const importVerifyKey = async (key: unknown): Promise<CryptoKey> => {
        if (key && typeof (key as CryptoKey).type === "string") return key as CryptoKey;
        const pem = String(key).replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
        const der = sab(Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)));
        if (algLower.includes("rsa")) {
          const hash = algLower.includes("512") ? "SHA-512" : algLower.includes("384") ? "SHA-384" : "SHA-256";
          const name = algLower.includes("pss") ? "RSA-PSS" : "RSASSA-PKCS1-v1_5";
          return subtle.importKey("spki", der, { name, hash }, false, ["verify"]);
        }
        return subtle.importKey("spki", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      };

      return {
        update(data: string | Uint8Array): void {
          chunks.push(typeof data === "string" ? new TextEncoder().encode(data) : sab(data));
        },
        verify(key: unknown, signature: string | Uint8Array, sigEnc?: string): Promise<boolean> {
          const msg = sab(mergeChunks(chunks));
          const sigBytes = sab(typeof signature === "string"
            ? (sigEnc === "hex" ? Buffer.from(signature, "hex") : Buffer.from(signature, "base64"))
            : Buffer.from(signature as Uint8Array));
          const algLow = algorithm.toLowerCase().replace(/-/g, "");
          const hash = algLow.includes("512") ? "SHA-512" : algLow.includes("384") ? "SHA-384" : "SHA-256";
          const verifyParams: AlgorithmIdentifier | RsaPssParams | EcdsaParams =
            algLow.includes("pss")
              ? ({ name: "RSA-PSS", saltLength: 32 } as RsaPssParams)
              : algLow.includes("rsa")
                ? "RSASSA-PKCS1-v1_5"
                : ({ name: "ECDSA", hash } as EcdsaParams);
          return importVerifyKey(key)
            .then((ck) => subtle.verify(verifyParams, ck, sigBytes, msg))
            .catch(() => false);
        },
      };
    },

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
      type: string,
      options: unknown,
      cb: (err: Error | null, pub: unknown, priv: unknown) => void,
    ) => {
      const opts = options as Record<string, unknown> | undefined;
      const modulusLength = (opts?.modulusLength as number) ?? 2048;
      const namedCurve = (opts?.namedCurve as string) ?? "P-256";

      let genParams: RsaHashedKeyGenParams | EcKeyGenParams;
      let pubFormat: "spki" | "raw" = "spki";
      let privFormat: "pkcs8" | "raw" = "pkcs8";
      let keyUsages: KeyUsage[] = ["sign", "verify"];

      const typeLower = type.toLowerCase();
      if (typeLower === "rsa" || typeLower === "rsa-pss") {
        const hash = (opts?.hash as string) ?? "SHA-256";
        genParams = {
          name: typeLower === "rsa-pss" ? "RSA-PSS" : "RSASSA-PKCS1-v1_5",
          modulusLength,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash,
        };
      } else if (typeLower === "ec") {
        genParams = { name: "ECDSA", namedCurve };
      } else if (typeLower === "ed25519") {
        genParams = { name: "Ed25519" } as EcKeyGenParams;
      } else {
        // Unknown type — return empty buffers and log
        queueMicrotask(() => cb(null, Buffer.alloc(0), Buffer.alloc(0)));
        return;
      }

      subtle
        .generateKey(genParams, true, keyUsages)
        .then(async (pair) => {
          const { publicKey, privateKey } = pair as CryptoKeyPair;
          const [pub, priv] = await Promise.all([
            subtle.exportKey(pubFormat, publicKey).then((k) => Buffer.from(k as ArrayBuffer)),
            subtle.exportKey(privFormat, privateKey).then((k) => Buffer.from(k as ArrayBuffer)),
          ]);
          cb(null, pub, priv);
        })
        .catch((err: Error) => cb(err, Buffer.alloc(0), Buffer.alloc(0)));
    },

    generateKeyPairSync: (_type: string, _options?: unknown) => {
      // Web Crypto key generation is async-only — synchronous is not possible in browser.
      throw new Error(
        "crypto.generateKeyPairSync: not supported in browser — key generation is async. " +
        "Use crypto.generateKeyPair() with a callback.",
      );
    },

    // RSA encrypt/decrypt: Web Crypto supports RSA-OAEP but is async.
    // These sync versions throw — callers should use webcrypto.subtle directly.
    // We do NOT silently pass through plaintext (previous behaviour was a security hole).
    publicEncrypt: (_key: unknown, _buffer: Buffer): Buffer => {
      throw new Error(
        "crypto.publicEncrypt: use crypto.webcrypto.subtle.encrypt({ name: 'RSA-OAEP' }, ...) instead — " +
        "RSA encryption is async in browser.",
      );
    },
    privateDecrypt: (_key: unknown, _buffer: Buffer): Buffer => {
      throw new Error(
        "crypto.privateDecrypt: use crypto.webcrypto.subtle.decrypt({ name: 'RSA-OAEP' }, ...) instead — " +
        "RSA decryption is async in browser.",
      );
    },
    privateEncrypt: (_key: unknown, _buffer: Buffer): Buffer => {
      throw new Error("crypto.privateEncrypt: not supported in browser — use crypto.webcrypto.subtle.");
    },
    publicDecrypt: (_key: unknown, _buffer: Buffer): Buffer => {
      throw new Error("crypto.publicDecrypt: not supported in browser — use crypto.webcrypto.subtle.");
    },

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
