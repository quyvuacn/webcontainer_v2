const root = await navigator.storage.getDirectory()
const bc = new BroadcastChannel('opfs_sync')

async function getHandle(path, create = false) {
  const parts = path.split('/').filter(Boolean)
  let dir = root
  for (const seg of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(seg, { create })
  }
  const name = parts.at(-1) || ''
  if (!name) return root
  return dir.getFileHandle(name, { create })
}

self.onmessage = async ({ data }) => {
  const { op, id, path, bytes } = data

  if (op === 'write') {
    try {
      const handle = await getHandle(path, true)
      const sync = await handle.createSyncAccessHandle()
      try {
        sync.truncate(0)
        sync.write(bytes)
        sync.flush()
      } finally {
        sync.close()
      }
      bc.postMessage({ type: 'file_changed', path })
    } catch (e) {
      self.postMessage({ id, err: String(e) })
      return
    }
    self.postMessage({ id })
  } else if (op === 'read') {
    try {
      const handle = await getHandle(path)
      const file = await handle.getFile()
      const content = new Uint8Array(await file.arrayBuffer())
      self.postMessage({ id, content })
    } catch (e) {
      self.postMessage({ id, err: String(e) })
    }
  } else if (op === 'list_all') {
    const results = []
    async function walk(dir, prefix) {
      for await (const [name, handle] of dir.entries()) {
        const p = prefix ? `${prefix}/${name}` : name
        if (handle.kind === 'file') {
          try {
            const file = await handle.getFile()
            const content = new Uint8Array(await file.arrayBuffer())
            results.push({ path: p, content })
          } catch (_) {}
        } else {
          await walk(handle, p)
        }
      }
    }
    await walk(root, '')
    self.postMessage({ id, results })
  }
}
