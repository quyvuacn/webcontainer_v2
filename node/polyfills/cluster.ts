/**
 * Node cluster polyfill — multi-process clustering. Not available in browser.
 * Stubs out the API so packages that optionally use cluster do not crash.
 * Always reports isMaster=true / isPrimary=true (single process model).
 */

import EventEmitter from "eventemitter3";

const clusterEmitter = new EventEmitter();

export function createClusterPolyfill(): Record<string, unknown> {
  return {
    isMaster: true,
    isPrimary: true,
    isWorker: false,
    worker: null,
    workers: {},
    settings: {},
    schedulingPolicy: 2, // SCHED_RR
    SCHED_NONE: 1,
    SCHED_RR: 2,

    fork(_env?: Record<string, string>): null {
      // Cannot fork in browser — return null
      return null;
    },
    setupMaster(_settings?: Record<string, unknown>): void {},
    setupPrimary(_settings?: Record<string, unknown>): void {},
    disconnect(_cb?: () => void): void {
      if (_cb) setTimeout(_cb, 0);
    },

    on: clusterEmitter.on.bind(clusterEmitter),
    once: clusterEmitter.once.bind(clusterEmitter),
    off: clusterEmitter.off.bind(clusterEmitter),
    emit: clusterEmitter.emit.bind(clusterEmitter),
    removeListener: clusterEmitter.removeListener.bind(clusterEmitter),
    removeAllListeners: clusterEmitter.removeAllListeners.bind(clusterEmitter),
    addListener: clusterEmitter.addListener.bind(clusterEmitter),
    listenerCount: clusterEmitter.listenerCount.bind(clusterEmitter),
  };
}
