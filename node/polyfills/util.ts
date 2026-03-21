/**
 * Node util module polyfill — uses the 'util' npm package (browserify).
 */

import util from 'util'

export function createUtilPolyfill() {
  return util
}
