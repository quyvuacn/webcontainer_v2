/**
 * SAB-based synchronous VFS channel.
 * Workers can make blocking readFileSync / existsSync calls to the main thread.
 * The main thread performs the operation (including lazy CDN fetch) and signals back.
 *
 * SAB layout (all offsets in bytes):
 *   [0..3]      int32: state  — 0=idle, 1=request, 2=response
 *   [4..7]      int32: op     — 1=readFile, 2=existsSync
 *   [8..11]     int32: path byte length
 *   [12..15]    int32: result — -1=not_found, 0=exists-false, N>0=file_bytes (or 1=exists-true)
 *   [16..1039]  path  bytes  (up to 1024 bytes)
 *   [1040..]    data  bytes  (up to 4 MB)
 */

const I_STATE = 0;
const I_OP = 1;
const I_PLEN = 2;
const I_RES = 3;

const PATH_OFF = 16;
const PATH_CAP = 1024;
const DATA_OFF = PATH_OFF + PATH_CAP; // 1040
const DATA_CAP = 4 * 1024 * 1024; // 4 MB

export const SYNC_SAB_SIZE = DATA_OFF + DATA_CAP;

export const OP_READ = 1;
export const OP_EXISTS = 2;

export function createSyncVfsSab(): SharedArrayBuffer {
  return new SharedArrayBuffer(SYNC_SAB_SIZE);
}

// ── Worker side ────────────────────────────────────────────────

/** Block until main thread reads and returns a file. Returns null if not found. */
export function syncRead(
  sab: SharedArrayBuffer,
  notifyPort: MessagePort,
  path: string,
): Uint8Array | null {
  const ctrl = new Int32Array(sab);
  const mem = new Uint8Array(sab);
  const enc = new TextEncoder().encode(path);
  const plen = Math.min(enc.length, PATH_CAP);

  Atomics.store(ctrl, I_OP, OP_READ);
  Atomics.store(ctrl, I_PLEN, plen);
  Atomics.store(ctrl, I_RES, 0);
  mem.set(enc.slice(0, plen), PATH_OFF);
  Atomics.store(ctrl, I_STATE, 1);
  notifyPort.postMessage({ type: "sync_vfs" });
  Atomics.wait(ctrl, I_STATE, 1);

  const res = Atomics.load(ctrl, I_RES);
  Atomics.store(ctrl, I_STATE, 0);
  if (res <= 0) return null;
  return new Uint8Array(sab, DATA_OFF, res).slice();
}

/** Block until main thread checks whether a path exists. */
export function syncExists(
  sab: SharedArrayBuffer,
  notifyPort: MessagePort,
  path: string,
): boolean {
  const ctrl = new Int32Array(sab);
  const mem = new Uint8Array(sab);
  const enc = new TextEncoder().encode(path);
  const plen = Math.min(enc.length, PATH_CAP);

  Atomics.store(ctrl, I_OP, OP_EXISTS);
  Atomics.store(ctrl, I_PLEN, plen);
  Atomics.store(ctrl, I_RES, 0);
  mem.set(enc.slice(0, plen), PATH_OFF);
  Atomics.store(ctrl, I_STATE, 1);
  notifyPort.postMessage({ type: "sync_vfs" });
  Atomics.wait(ctrl, I_STATE, 1);

  const res = Atomics.load(ctrl, I_RES);
  Atomics.store(ctrl, I_STATE, 0);
  return res > 0;
}

// ── Main thread side ───────────────────────────────────────────

/**
 * Handle one pending sync request on this SAB.
 * Call this from the sync notification port's onmessage handler.
 */
export async function handleSyncFsRequest(
  sab: SharedArrayBuffer,
  handleRead: (path: string) => Promise<Uint8Array | null>,
  handleExists: (path: string) => Promise<boolean>,
): Promise<void> {
  const ctrl = new Int32Array(sab);
  if (Atomics.load(ctrl, I_STATE) !== 1) return; // stale wake-up

  const op = Atomics.load(ctrl, I_OP);
  const plen = Atomics.load(ctrl, I_PLEN);
  // Must copy out of SharedArrayBuffer before decoding — TextDecoder rejects SAB views
  const path = new TextDecoder().decode(
    new Uint8Array(sab, PATH_OFF, plen).slice(),
  );

  try {
    if (op === OP_EXISTS) {
      const ok = await handleExists(path);
      Atomics.store(ctrl, I_RES, ok ? 1 : -1);
    } else {
      const bytes = await handleRead(path);
      if (bytes && bytes.length <= DATA_CAP) {
        new Uint8Array(sab, DATA_OFF, DATA_CAP).set(bytes);
        Atomics.store(ctrl, I_RES, bytes.length);
      } else {
        Atomics.store(ctrl, I_RES, -1);
      }
    }
  } catch {
    Atomics.store(ctrl, I_RES, -1);
  }

  Atomics.store(ctrl, I_STATE, 2);
  Atomics.notify(ctrl, I_STATE);
}
