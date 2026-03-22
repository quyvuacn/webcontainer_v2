/**
 * Node assert module polyfill — uses the 'assert' npm package (browserify).
 */

import assert from "assert";

export function createAssertPolyfill() {
  return assert;
}
