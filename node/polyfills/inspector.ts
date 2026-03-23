/**
 * Stub for node:inspector — debugging API not available in browser.
 * Vite uses inspector.Session for CPU profiling (optional, only when --profile flag used).
 */

import EventEmitter from "eventemitter3";

class Session extends EventEmitter {
  connect(): void {}
  connectToMainThread(): void {}
  disconnect(): void {}

  post(
    method: string,
    _params?: Record<string, unknown>,
    callback?: (err: Error | null, result: Record<string, unknown>) => void,
  ): void {
    // Stub: immediately call callback with no error and empty result
    if (typeof _params === "function") {
      (_params as (err: null, result: Record<string, unknown>) => void)(
        null,
        {},
      );
    } else if (typeof callback === "function") {
      callback(null, {});
    }
  }
}

export function createInspectorPolyfill(): Record<string, unknown> {
  const mod = {
    open: () => {},
    close: () => {},
    url: () => undefined,
    waitForDebugger: () => {},
    Session,
    console: {},
    default: {} as Record<string, unknown>,
  };
  mod.default = mod;
  return mod;
}
