/**
 * Stub for node:inspector — debugging API not available in browser.
 */

export function createInspectorPolyfill(): Record<string, unknown> {
  return {
    open: () => {},
    close: () => {},
    url: () => undefined,
    waitForDebugger: () => {},
  }
}
