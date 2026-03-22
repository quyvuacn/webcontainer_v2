interface FileSystemSyncAccessHandle {
  truncate(newSize: number): void
  flush(): void
  close(): void
  write(buffer: BufferSource | ArrayBufferView, offset?: number): number
}

type FileHandleWithSync = { createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> }

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
  return String(path ?? "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\//, "")
    .split("/")
    .filter(seg => seg.length > 0 && seg !== ".")
    .join("/")
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
    if (typeof name !== 'string' || !name) continue
    const path = prefix ? `${prefix}/${name}` : name
    if (handle.kind === "file") {
      const file = await (handle as FileSystemFileHandle).getFile()
      const content = new Uint8Array(await file.arrayBuffer())
      results.push({ path, content })
    } else {
      await walkAll(handle as FileSystemDirectoryHandle, path, results)
    }
  }
}

async function handleWrite(rootDir: Promise<FileSystemDirectoryHandle>, { path, bytes }: { path: string; bytes: Uint8Array }) {
  return queueWrite(path, async () => {
    const handle = await getFileHandle(rootDir, path, true)
    const sync = await (handle as unknown as FileHandleWithSync).createSyncAccessHandle()
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

const VFS_BASE = 'vfs'
let vfsRootPromise: Promise<FileSystemDirectoryHandle> | null = null

async function getVfsRoot() {
  if (vfsRootPromise) return vfsRootPromise
  vfsRootPromise = (async () => {
  const root = await navigator.storage.getDirectory()
  const vfsDir = await root.getDirectoryHandle(VFS_BASE, { create: true })
  const entries = []
  for await (const _ of vfsDir.entries()) {
    entries.push(1)
    if (entries.length > 0) break
  }
  if (entries.length === 0) {
    for await (const [name, handle] of root.entries()) {
      if (name === VFS_BASE || typeof name !== 'string' || !name) continue
      if (handle.kind === 'file') {
        const f = await (handle as FileSystemFileHandle).getFile()
        const content = new Uint8Array(await f.arrayBuffer())
        const target = await getFileHandle(Promise.resolve(vfsDir), name, true)
        const sync = await (target as unknown as FileHandleWithSync).createSyncAccessHandle()
        try {
          sync.truncate(0)
          sync.write(content)
          sync.flush()
        } finally {
          sync.close()
        }
      } else {
        await migrateDir(handle as FileSystemDirectoryHandle, vfsDir, name)
      }
    }
  }
  return vfsDir
  })()
  return vfsRootPromise
}

async function migrateDir(src: FileSystemDirectoryHandle, parent: FileSystemDirectoryHandle, name: string) {
  const dest = await parent.getDirectoryHandle(name, { create: true })
  for await (const [n, h] of src.entries()) {
    if (typeof n !== 'string' || !n) continue
    if (h.kind === 'file') {
      const f = await (h as FileSystemFileHandle).getFile()
      const content = new Uint8Array(await f.arrayBuffer())
      const target = await dest.getFileHandle(n, { create: true })
      const sync = await (target as unknown as FileHandleWithSync).createSyncAccessHandle()
      try {
        sync.truncate(0)
        sync.write(content)
        sync.flush()
      } finally {
        sync.close()
      }
    } else {
      await migrateDir(h as FileSystemDirectoryHandle, dest, n)
    }
  }
}

;(self as unknown as Worker).onmessage = async ({ data }: MessageEvent<{ op: string; id: string; path?: string; bytes?: Uint8Array }>) => {
  const { op, id, ...args } = data
  let result: unknown

  try {
    const vfsRoot = getVfsRoot()
    switch (op) {
      case "write":
        result = await handleWrite(vfsRoot, args as { path: string; bytes: Uint8Array })
        break
      case "delete":
        result = await handleDelete(vfsRoot, args as { path: string })
        break
      case "read":
        result = await handleRead(vfsRoot, args as { path: string })
        break
      case "list_all":
        result = await handleListAll(vfsRoot)
        break
      default:
        result = { err: `Unknown op: ${op}` }
    }
  } catch (err) {
    result = { err: String(err) }
  }

  ;(self as unknown as Worker).postMessage(Object.assign({ id }, result))
}
