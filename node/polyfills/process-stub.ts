/**
 * Minimal process stub for browser. Must be loaded before any module that
 * expects process (e.g. util, assert npm packages). The real ProcessPolyfill
 * is injected per-session via __wcBuiltins; this stub satisfies eager checks.
 */
if (typeof (globalThis as Record<string, unknown>).process === "undefined") {
  const stub = {
    env: {} as Record<string, string>,
    version: "v20.11.0",
    versions: {} as Record<string, string>,
    platform: "linux" as const,
    arch: "x64",
    pid: 1,
    ppid: 0,
    browser: true,
    nextTick: (fn: () => void, ...args: unknown[]) =>
      queueMicrotask(() => fn(...args)),
    cwd: () => "/",
    noDeprecation: false,
    throwDeprecation: false,
    traceDeprecation: false,
  };
  (globalThis as Record<string, unknown>).process = stub;
}
