/**
 * Node polyfills — fs, process, path, url, util, assert, os, events, stream, buffer, crypto.
 */

import { path } from './path'
import { createUrlPolyfill } from './url'
import { createUtilPolyfill } from './util'
import { createAssertPolyfill } from './assert'
import { createOsPolyfill } from './os'
import { createEventsPolyfill, EventEmitter } from './events'
import { createStreamPolyfill } from './stream'
import { createBufferPolyfill } from './buffer'
import { createCryptoPolyfill } from './crypto'
import { createFsPolyfill } from './fs'
import { ProcessPolyfill, ProcessExitError } from './process'

export { path }
export { createUrlPolyfill }
export { createUtilPolyfill }
export { createAssertPolyfill }
export { createOsPolyfill }
export { createEventsPolyfill, EventEmitter }
export { createStreamPolyfill }
export { createBufferPolyfill }
export { createCryptoPolyfill }
export { createFsPolyfill }
export { ProcessPolyfill, ProcessExitError }
