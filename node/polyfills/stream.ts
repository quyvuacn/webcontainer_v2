/**
 * Node stream module polyfill — wraps readable-stream.
 */

import * as rs from "readable-stream";
import { EventEmitter } from "./events";

export const Readable = rs.Readable;
export const Writable = rs.Writable;
export const Duplex = rs.Duplex;
export const Transform = rs.Transform;
export const PassThrough = rs.PassThrough;

export function createStreamPolyfill() {
  const mod = rs as unknown as Record<string, unknown>;
  return {
    ...mod,
    // Legacy: older Node.js exposed stream.EventEmitter
    EventEmitter,
    // Ensure stream.promises exists
    promises: {
      pipeline: rs.pipeline,
      finished: rs.finished,
    },
  };
}
