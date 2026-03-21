const bc = new BroadcastChannel("vfs_opfs_sync")
const writeQueue = new Map<string, Promise<unknown>>()

function queueWrite(path: string, fn: () => Promise<unknown>) {
  const prev = writeQueue.get(path) ?? Promise.resolve()
  const next = prev.then(fn).finally(() => {
    if (writeQueue.get(path) === next) writeQueue.delete(path)
  })
  writeQueue.set(path, next)
  return next
}

function normalizePath(path: unknown) {
  return String(path ?? "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\//, "")
}

function sanitizeName(name: string) {
  return name.replace(/[\x00-\x1f\\/:*?"<>|]/g, "_")
}

async function getFileHandle(rootDir: Promise<FileSystemDirectoryHandle>, path: string, create = false) {
  const parts = normalizePath(path).split("/").filter(Boolean)
  if (!parts.length) throw new Error("Empty path")
  let dir = await rootDir
  for (const seg of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(sanitizeName(seg), { create })
  }
  return dir.getFileHandle(sanitizeName(parts.at(-1)!), { create })
}

async function getDirHandle(rootDir: Promise<FileSystemDirectoryHandle>, path: string, create = false) {
  const parts = normalizePath(path).split("/").filter(Boolean)
  let dir = await rootDir
  for (const seg of parts) {
    dir = await dir.getDirectoryHandle(sanitizeName(seg), { create })
  }
  return dir
}

async function walkAll(dir: FileSystemDirectoryHandle, prefix: string, results: { path: string; content: Uint8Array }[]) {
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name
    if (handle.kind === "file") {
      const file = await handle.getFile()
      const content = new Uint8Array(await file.arrayBuffer())
      results.push({ path, content })
    } else {
      await walkAll(handle, path, results)
    }
  }
}

async function handleWrite(rootDir: Promise<FileSystemDirectoryHandle>, { path, bytes }: { path: string; bytes: Uint8Array }) {
  return queueWrite(path, async () => {
    const handle = await getFileHandle(rootDir, path, true)
    const sync = await handle.createSyncAccessHandle()
    try {
      sync.truncate(0)
      sync.write(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
      sync.flush()
    } finally {
      sync.close()
    }
    bc.postMessage({ type: "file_changed", path })
    return {}
  })
}

async function handleDelete(rootDir: Promise<FileSystemDirectoryHandle>, { path }: { path: string }) {
  const parts = normalizePath(path).split("/").filter(Boolean)
  if (parts.length === 0) return { deleted: false }

  try {
    let dir = await rootDir
    for (const seg of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(sanitizeName(seg))
    }
    await dir.removeEntry(sanitizeName(parts.at(-1)!), { recursive: true })
    bc.postMessage({ type: "file_changed", path })
    return { deleted: true }
  } catch {
    return { deleted: false }
  }
}

async function handleRead(rootDir: Promise<FileSystemDirectoryHandle>, { path }: { path: string }) {
  try {
    const handle = await getFileHandle(rootDir, path)
    const file = await handle.getFile()
    const content = new Uint8Array(await file.arrayBuffer())
    return { content }
  } catch {
    return { content: null }
  }
}

async function handleListAll(rootDir: Promise<FileSystemDirectoryHandle>) {
  const files: { path: string; content: Uint8Array }[] = []
  await walkAll(await rootDir, "", files)
  return { files }
}

const rootPromise = navigator.storage.getDirectory()

;(self as Worker).onmessage = async ({ data }: MessageEvent<{ op: string; id: string; path?: string; bytes?: Uint8Array }>) => {
  const { op, id, ...args } = data
  let result: unknown

  try {
    switch (op) {
      case "write":
        result = await handleWrite(rootPromise, args as { path: string; bytes: Uint8Array })
        break
      case "delete":
        result = await handleDelete(rootPromise, args as { path: string })
        break
      case "read":
        result = await handleRead(rootPromise, args as { path: string })
        break
      case "list_all":
        result = await handleListAll(rootPromise)
        break
      default:
        result = { err: `Unknown op: ${op}` }
    }
  } catch (err) {
    result = { err: String(err) }
  }

  ;(self as Worker).postMessage({ id, ...result })
}
