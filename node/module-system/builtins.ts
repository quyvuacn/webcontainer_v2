/**
 * Map built-in module names to polyfill implementations.
 */

import '../polyfills/process-stub'
import type { VirtualFS } from '../vfs/core/vfs'
import type { FileSource } from '../file-source/types'
import { path } from '../polyfills/path'
import { createUrlPolyfill } from '../polyfills/url'
import { createUtilPolyfill } from '../polyfills/util'
import { createAssertPolyfill } from '../polyfills/assert'
import { createOsPolyfill } from '../polyfills/os'
import { createEventsPolyfill } from '../polyfills/events'
import { createStreamPolyfill } from '../polyfills/stream'
import { createBufferPolyfill } from '../polyfills/buffer'
import { createCryptoPolyfill } from '../polyfills/crypto'
import { createFsPolyfill, type FsPolyfillOptions } from '../polyfills/fs'
import { createHttpPolyfill } from '../polyfills/http'
import { createHttpsPolyfill } from '../polyfills/http'
import { createTtyPolyfill } from '../polyfills/tty'
import { createChildProcessPolyfill } from '../polyfills/child_process'
import { createInspectorPolyfill } from '../polyfills/inspector'
import { createModulePolyfill } from '../polyfills/module'
import { createV8Polyfill } from '../polyfills/v8'
import { createTlsPolyfill } from '../polyfills/tls'
import { createHttp2Polyfill } from '../polyfills/http2'
import { createPerfHooksPolyfill } from '../polyfills/perf_hooks'
import { createStringDecoderPolyfill } from '../polyfills/string_decoder'
import { createDnsPolyfill } from '../polyfills/dns'
import { createWorkerThreadsPolyfill } from '../polyfills/worker_threads'
import { createZlibPolyfill } from '../polyfills/zlib'
import { createReadlinePolyfill } from '../polyfills/readline'
import { createTimersPolyfill } from '../polyfills/timers'
import type { ProcessPolyfill } from '../polyfills/process'

export function createBuiltinMap(
  vfs: VirtualFS,
  process: ProcessPolyfill,
  getCwd: () => string,
  syncCache?: Map<string, string | Uint8Array>,
  fileSource?: FileSource,
): Map<string, unknown> {
  const fsOpts: FsPolyfillOptions = syncCache !== undefined ? { getCwd, syncCache } : { getCwd }
  if (fileSource) fsOpts.fileSource = fileSource
  const fs = createFsPolyfill(vfs, fsOpts)
  const url = createUrlPolyfill({ getCwd })
  const util = createUtilPolyfill()
  const assert = createAssertPolyfill()
  const os = createOsPolyfill()
  const events = createEventsPolyfill()
  const stream = createStreamPolyfill()
  const buffer = createBufferPolyfill()
  const crypto = createCryptoPolyfill()

  const map = new Map<string, unknown>([
    ['fs', fs],
    ['fs/promises', fs.promises],
    ['path', path],
    ['process', process],
    ['os', os],
    ['events', events],
    ['stream', stream],
    ['buffer', buffer],
    ['crypto', crypto],
    ['url', url],
    ['util', util],
    ['assert', assert],
    ['node:fs', fs],
    ['node:fs/promises', fs.promises],
    ['node:path', path],
    ['node:process', process],
    ['node:os', os],
    ['node:events', events],
    ['node:stream', stream],
    ['node:buffer', buffer],
    ['node:crypto', crypto],
    ['node:url', url],
    ['node:util', util],
    ['node:assert', assert],
    ['http', createHttpPolyfill()],
    ['https', createHttpsPolyfill()],
    ['node:http', createHttpPolyfill()],
    ['node:https', createHttpsPolyfill()],
    ['tty', createTtyPolyfill()],
    ['node:tty', createTtyPolyfill()],
    ['child_process', createChildProcessPolyfill()],
    ['node:child_process', createChildProcessPolyfill()],
    ['inspector', createInspectorPolyfill()],
    ['node:inspector', createInspectorPolyfill()],
    ['module', createModulePolyfill()],
    ['node:module', createModulePolyfill()],
    ['v8', createV8Polyfill()],
    ['node:v8', createV8Polyfill()],
    ['tls', createTlsPolyfill()],
    ['node:tls', createTlsPolyfill()],
    ['http2', createHttp2Polyfill()],
    ['node:http2', createHttp2Polyfill()],
    ['perf_hooks', createPerfHooksPolyfill()],
    ['node:perf_hooks', createPerfHooksPolyfill()],
    ['string_decoder', createStringDecoderPolyfill()],
    ['node:string_decoder', createStringDecoderPolyfill()],
    ['dns', createDnsPolyfill()],
    ['node:dns', createDnsPolyfill()],
    ['worker_threads', createWorkerThreadsPolyfill()],
    ['node:worker_threads', createWorkerThreadsPolyfill()],
    ['zlib', createZlibPolyfill()],
    ['node:zlib', createZlibPolyfill()],
    ['readline', createReadlinePolyfill()],
    ['node:readline', createReadlinePolyfill()],
    ['timers', createTimersPolyfill()],
    ['node:timers', createTimersPolyfill()],
  ])

  return map
}
