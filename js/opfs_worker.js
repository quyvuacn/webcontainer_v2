/**
 * opfs_worker.js — dedicated Worker that owns all OPFS I/O.
 *
 * `FileSystemSyncAccessHandle` is only available inside Workers (spec),
 * so every OPFS operation runs here. The Main Thread communicates via
 * postMessage / MessageChannel through opfs_bridge.js.
 *
 * Protocol: every message has { op, id, ...args }.
 * Every response has { id, ...result }.
 *
 * ops:
 *   write     { path, bytes: Uint8Array }  → {}
 *   delete    { path }                     → { deleted: bool }
 *   read      { path }                     → { content: Uint8Array | null }
 *   list_all  {}                           → { files: [{path, content}] }
 */

const root = navigator.storage.getDirectory();

// BroadcastChannel notifies other tabs when a file changes.
const bc = new BroadcastChannel("vfs_opfs_sync");

// ── Helpers ────────────────────────────────────────────────────────────────

async function getFileHandle(rootDir, path, create = false) {
  const parts = path.split("/").filter(Boolean);
  let dir = await rootDir;
  for (const seg of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(seg, { create });
  }
  return dir.getFileHandle(parts.at(-1), { create });
}

async function getDirHandle(rootDir, path, create = false) {
  const parts = path.split("/").filter(Boolean);
  let dir = await rootDir;
  for (const seg of parts) {
    dir = await dir.getDirectoryHandle(seg, { create });
  }
  return dir;
}

async function walkAll(dir, prefix, results) {
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file") {
      const file = await handle.getFile();
      const content = new Uint8Array(await file.arrayBuffer());
      results.push({ path, content });
    } else {
      await walkAll(handle, path, results);
    }
  }
}

// ── Operation handlers ─────────────────────────────────────────────────────

async function handleWrite(rootDir, { path, bytes }) {
  const handle = await getFileHandle(rootDir, path, true);

  // createSyncAccessHandle gives an exclusive lock — throws if another
  // tab holds the handle open on the same file.
  const sync = await handle.createSyncAccessHandle();
  try {
    sync.truncate(0);
    sync.write(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    sync.flush();
  } finally {
    sync.close();
  }

  // Notify other tabs to invalidate their RAM cache for this path.
  bc.postMessage({ type: "file_changed", path });
  return {};
}

async function handleDelete(rootDir, { path }) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return { deleted: false };

  try {
    let dir = await rootDir;
    for (const seg of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(seg);
    }
    await dir.removeEntry(parts.at(-1), { recursive: true });
    bc.postMessage({ type: "file_changed", path });
    return { deleted: true };
  } catch {
    return { deleted: false };
  }
}

async function handleRead(rootDir, { path }) {
  try {
    const handle = await getFileHandle(rootDir, path);
    const file = await handle.getFile();
    const content = new Uint8Array(await file.arrayBuffer());
    return { content };
  } catch {
    return { content: null };
  }
}

async function handleListAll(rootDir) {
  const files = [];
  await walkAll(await rootDir, "", files);
  return { files };
}

// ── Message dispatch ───────────────────────────────────────────────────────

const rootPromise = navigator.storage.getDirectory();

self.onmessage = async ({ data }) => {
  const { op, id, ...args } = data;
  let result;

  try {
    switch (op) {
      case "write":
        result = await handleWrite(rootPromise, args);
        break;
      case "delete":
        result = await handleDelete(rootPromise, args);
        break;
      case "read":
        result = await handleRead(rootPromise, args);
        break;
      case "list_all":
        result = await handleListAll(rootPromise);
        break;
      default:
        result = { err: `Unknown op: ${op}` };
    }
  } catch (err) {
    result = { err: String(err) };
  }

  self.postMessage({ id, ...result });
};
