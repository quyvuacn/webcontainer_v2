const enc = new TextEncoder()
const dec = new TextDecoder()

export function serializeRequest(request) {
  const headers = []
  request.headers.forEach((v, k) => headers.push([k, v]))
  const meta = JSON.stringify({ method: request.method, url: request.url, headers })
  const metaBytes = enc.encode(meta)
  const metaLen = metaBytes.length
  return request.arrayBuffer().then(body => {
    const out = new Uint8Array(4 + metaLen + body.byteLength)
    new DataView(out.buffer).setUint32(0, metaLen, true)
    out.set(metaBytes, 4)
    out.set(new Uint8Array(body), 4 + metaLen)
    return out
  })
}

export function deserializeRequest(bytes) {
  const metaLen = new DataView(bytes.buffer).getUint32(0, true)
  const meta = JSON.parse(dec.decode(bytes.slice(4, 4 + metaLen)))
  const body = bytes.slice(4 + metaLen)
  return { method: meta.method, url: meta.url, headers: Object.fromEntries(meta.headers || []), body }
}

export function serializeResponse(status, headers, body) {
  const h = headers ? Object.entries(headers).map(([k, v]) => [k, String(v)]) : []
  const meta = JSON.stringify({ status, headers: h })
  const metaBytes = enc.encode(meta)
  const metaLen = metaBytes.length
  const bodyBytes = body instanceof Uint8Array ? body : enc.encode(body || '')
  const out = new Uint8Array(4 + metaLen + bodyBytes.length)
  new DataView(out.buffer).setUint32(0, metaLen, true)
  out.set(metaBytes, 4)
  out.set(bodyBytes, 4 + metaLen)
  return out
}

export function deserializeResponse(bytes) {
  const metaLen = new DataView(bytes.buffer).getUint32(0, true)
  const meta = JSON.parse(dec.decode(bytes.slice(4, 4 + metaLen)))
  const body = bytes.slice(4 + metaLen)
  return new Response(body, { status: meta.status || 200, headers: Object.fromEntries(meta.headers || []) })
}
