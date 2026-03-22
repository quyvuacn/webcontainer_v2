/**
 * Node perf_hooks polyfill — uses browser globalThis.performance.
 */

export function createPerfHooksPolyfill(): Record<string, unknown> {
  const perf = globalThis.performance;
  return {
    performance: perf,
    PerformanceObserver:
      (globalThis as unknown as { PerformanceObserver?: unknown })
        .PerformanceObserver ?? class {},
    monitorEventLoopDelay: () => ({ enable: () => {}, disable: () => {} }),
    createHistogram: () => ({}),
    constants: { NODE_PERFORMANCE_GC_MAJOR: 0, NODE_PERFORMANCE_GC_MINOR: 0 },
  };
}
