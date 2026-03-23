/**
 * Node perf_hooks polyfill — uses browser globalThis.performance.
 */

export function createPerfHooksPolyfill(): Record<string, unknown> {
  const perf = globalThis.performance;

  // Augment performance with Node-specific methods if missing
  const perfPolyfill = {
    ...perf,
    // performance.now() is already on the browser object
    now: () => perf.now(),
    timeOrigin: perf.timeOrigin,

    mark: (name: string, options?: Record<string, unknown>) => {
      if (perf.mark) return perf.mark(name, options as PerformanceMarkOptions);
    },
    measure: (
      name: string,
      startOrOptions?: string | Record<string, unknown>,
      end?: string,
    ) => {
      try {
        if (perf.measure)
          return perf.measure(
            name,
            startOrOptions as string,
            end,
          );
      } catch {
        // ignore: mark may not exist
      }
      return { name, duration: 0, startTime: 0 };
    },
    clearMarks: (name?: string) => perf.clearMarks?.(name),
    clearMeasures: (name?: string) => perf.clearMeasures?.(name),
    getEntries: () => perf.getEntries?.() ?? [],
    getEntriesByName: (name: string, type?: string) =>
      perf.getEntriesByName?.(name, type) ?? [],
    getEntriesByType: (type: string) =>
      perf.getEntriesByType?.(type) ?? [],

    eventLoopUtilization: (_util1?: unknown, _util2?: unknown) => ({
      idle: 0,
      active: 0,
      utilization: 0,
    }),

    nodeTiming: {
      name: "node",
      entryType: "node",
      startTime: 0,
      duration: 0,
      nodeStart: 0,
      v8Start: 0,
      bootstrapComplete: 0,
      environment: 0,
      loopStart: 0,
      loopExit: -1,
      idleTime: 0,
    },
  };

  return {
    performance: perfPolyfill,
    PerformanceObserver:
      (globalThis as unknown as { PerformanceObserver?: unknown })
        .PerformanceObserver ?? class PerformanceObserver {
          constructor(_cb: unknown) {}
          observe(_opts?: unknown) {}
          disconnect() {}
          takeRecords() { return []; }
        },
    monitorEventLoopDelay: (_options?: { resolution?: number }) => ({
      enable: () => {},
      disable: () => {},
      reset: () => {},
      percentile: (_p: number) => 0,
      percentiles: new Map<number, number>(),
      exceeds: 0,
      min: 0,
      max: 0,
      mean: 0,
      stddev: 0,
    }),
    createHistogram: (_options?: unknown) => ({
      record: (_val: number) => {},
      recordDelta: () => {},
      reset: () => {},
      add: (_h: unknown) => {},
      percentile: (_p: number) => 0,
      percentiles: new Map<number, number>(),
      exceeds: 0,
      min: 0,
      max: 0,
      mean: 0,
      stddev: 0,
      count: 0,
    }),
    constants: {
      NODE_PERFORMANCE_GC_MAJOR: 4,
      NODE_PERFORMANCE_GC_MINOR: 1,
      NODE_PERFORMANCE_GC_INCREMENTAL: 8,
      NODE_PERFORMANCE_GC_WEAKCB: 16,
      NODE_PERFORMANCE_MILESTONE_BOOTSTRAP_COMPLETE: 7,
      NODE_PERFORMANCE_MILESTONE_LOOP_START: 5,
      NODE_PERFORMANCE_MILESTONE_LOOP_EXIT: 6,
    },
    PerformanceEntry: class PerformanceEntry {},
    PerformanceMark: class PerformanceMark {},
    PerformanceMeasure: class PerformanceMeasure {},
    PerformanceNodeTiming: class PerformanceNodeTiming {},
    PerformanceResourceTiming: class PerformanceResourceTiming {},
  };
}
