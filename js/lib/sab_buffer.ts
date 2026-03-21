const BUF_META = 4

export function createBuffer(size: number) {
  const buf = new SharedArrayBuffer(size + BUF_META)
  new DataView(buf).setUint32(size, 0, true)
  return buf
}

export function readBuffer(buf: SharedArrayBuffer) {
  const view = new DataView(buf)
  const used = view.getUint32(buf.byteLength - 4, true)
  return new TextDecoder().decode(new Uint8Array(buf, 0, used))
}

export function writeToBuffer(buf: SharedArrayBuffer, data: string | Uint8Array) {
  if (!buf) return
  const arr = new Uint8Array(buf)
  const view = new DataView(buf)
  const lenOff = buf.byteLength - 4
  const used = view.getUint32(lenOff, true)
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  arr.set(bytes, used)
  view.setUint32(lenOff, used + bytes.length, true)
}
