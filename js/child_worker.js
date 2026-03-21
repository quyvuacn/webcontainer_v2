import { hasRequire, createRequire } from './cjs_loader.js'

let vfsPort = null
let ipcPort = null
let stdin = null
let stdout = null
let stderr = null
let done = null
let isSync = false

function vfsRead(path) {
  return new Promise(resolve => {
    const id = crypto.randomUUID()
    const handler = ({ data: d }) => {
      if (d.id !== id) return
      vfsPort.removeEventListener('message', handler)
      resolve(d.bytes ? new Uint8Array(d.bytes) : null)
    }
    vfsPort.addEventListener('message', handler)
    vfsPort.postMessage({ op: 'read', path, id })
  })
}

function vfsWrite(path, bytes) {
  return new Promise(resolve => {
    const id = crypto.randomUUID()
    const handler = ({ data: d }) => {
      if (d.id !== id) return
      vfsPort.removeEventListener('message', handler)
      resolve()
    }
    vfsPort.addEventListener('message', handler)
    vfsPort.postMessage({ op: 'write', path, bytes: [...new Uint8Array(bytes)], id })
  })
}

function writeTo(buf, data) {
  if (!buf) return
  const arr = new Uint8Array(buf)
  const view = new DataView(buf)
  const lenOff = buf.byteLength - 4
  const used = view.getUint32(lenOff, true)
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  arr.set(bytes, used)
  view.setUint32(lenOff, used + bytes.length, true)
}


async function runScript(file, args, env = {}) {
  const bytes = await vfsRead(file)
  if (!bytes) {
    writeTo(stderr, `Error: Cannot find module '${file}'\n`)
    if (done) { Atomics.store(new Int32Array(done.buffer || done), 0, 1); Atomics.notify(new Int32Array(done.buffer || done), 0) }
    return
  }
  const code = new TextDecoder().decode(bytes)
  const out = { buf: stdout, write: (s) => writeTo(stdout, s) }
  const err = { buf: stderr, write: (s) => writeTo(stderr, s) }
  const proc = { argv: [file, ...args], env }
  const projectRoot = file.split('/')[0] || 'project'

  try {
    if (hasRequire(code)) {
      const req = createRequire(p => vfsRead(p), projectRoot)
      const mod = { exports: {} }
      const dir = file.replace(/\/[^/]+$/, '')
      const transformed = code.replace(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, "(await require('$1'))")
      const fn = new Function(
        'process', 'require', 'console', 'exports', 'module',
        `(async function() {
          const __dirname = '${dir}';
          const __filename = '${file}';
          ${transformed}
          return module.exports;
        })()`
      )
      await fn(proc, req, { log: (...a) => out.write(a.join(' ') + '\n') }, mod.exports, mod)
    } else {
      const mod = { exports: {} }
      const fn = new Function('process', 'require', 'console', 'exports', 'module', code)
      fn(proc, () => {}, { log: (...a) => out.write(a.join(' ') + '\n') }, mod.exports, mod)
    }
  } catch (e) {
    err.write(String(e) + '\n')
  }
  if (done) {
    Atomics.store(new Int32Array(done), 0, 1)
    Atomics.notify(new Int32Array(done), 0)
  }
}

self.onmessage = ({ data }) => {
  vfsPort = data.vfsPort
  ipcPort = data.ipcPort
  stdin = data.stdin
  stdout = data.stdout
  stderr = data.stderr
  done = data.done
  isSync = !!done
  runScript(data.file, data.args || [], data.env || {})
}
