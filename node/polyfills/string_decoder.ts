/**
 * Node string_decoder polyfill — uses the 'string_decoder' npm package (browserify).
 */

import { StringDecoder } from "string_decoder";

export { StringDecoder };

export function createStringDecoderPolyfill() {
  return { StringDecoder };
}
