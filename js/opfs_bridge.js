let opfsWorker = null
const pending = new Map()

export function initOpfsBridge(workerUrl) {
  if (opfsWorker) return
  opfsWorker = new Worker(workerUrl)
  opfsWorker.onmessage = ({ data }) => {
    const resolve = pending.get(data.id)
    if (resolve) {
      pending.delete(data.id)
      resolve(data)
    }
  }
}

function send(op) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    pending.set(id, (data) => {
      if (data.err) reject(new Error(data.err))
      else resolve(data)
    })
    opfsWorker.postMessage({ ...op, id })
  })
}

export function opfsWrite(path, bytes) {
  return send({ op: 'write', path, bytes })
}

export function opfsRead(path) {
  return send({ op: 'read', path }).then(d => d.content)
}

export function opfsListAll() {
  return send({ op: 'list_all' }).then(d => d.results || [])
}

export function createBroadcastChannel(callback) {
  const bc = new BroadcastChannel('opfs_sync')
  bc.onmessage = ({ data }) => {
    if (data.type === 'file_changed') callback(data.path)
  }
  return bc
}
