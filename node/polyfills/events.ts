/**
 * Node events module polyfill — wraps eventemitter3.
 */

import EventEmitter from "eventemitter3";

export {
  EventEmitter,

  // Self-reference so `require('events').EventEmitter` works when default = EventEmitter
};
(
  EventEmitter as unknown as { EventEmitter?: typeof EventEmitter }
).EventEmitter = EventEmitter;

export function createEventsPolyfill() {
  return {
    EventEmitter,
    once: (
      emitter: InstanceType<typeof EventEmitter>,
      eventName: string | symbol,
    ): Promise<unknown[]> =>
      new Promise((resolve, reject) => {
        const evName = String(eventName);
        const onEvent = (...args: unknown[]) => {
          emitter.off("error", onError);
          resolve(args);
        };
        const onError = (err: unknown) => {
          emitter.off(evName, onEvent);
          reject(err instanceof Error ? err : new Error(String(err)));
        };
        emitter.once(evName, onEvent);
        emitter.once("error", onError);
      }),

    // Async iterator over an event — yields arrays of event arguments.
    // Buffers events that arrive before the consumer calls next().
    on: (emitter: InstanceType<typeof EventEmitter>, eventName: string | symbol): AsyncIterable<unknown[]> => {
      const evName = String(eventName);
      const queue: unknown[][] = [];
      const waiters: Array<(v: IteratorResult<unknown[]>) => void> = [];
      let done = false;
      let rejectWaiter: ((e: unknown) => void) | null = null;

      const onEvent = (...args: unknown[]) => {
        if (waiters.length > 0) {
          waiters.shift()!({ value: args, done: false });
        } else {
          queue.push(args);
        }
      };
      const onError = (err: unknown) => {
        done = true;
        emitter.off(evName, onEvent);
        if (rejectWaiter) rejectWaiter(err);
        else { /* store error for next pull */ queue.push([]); }
      };

      emitter.on(evName, onEvent);
      emitter.once("error", onError);

      return {
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<unknown[]>> {
              if (queue.length > 0) return Promise.resolve({ value: queue.shift()!, done: false });
              if (done) return Promise.resolve({ value: [], done: true });
              return new Promise((resolve, reject) => {
                rejectWaiter = reject;
                waiters.push(resolve);
              });
            },
            return(): Promise<IteratorResult<unknown[]>> {
              done = true;
              emitter.off(evName, onEvent);
              emitter.off("error", onError);
              return Promise.resolve({ value: [], done: true });
            },
          };
        },
      };
    },

    getEventListeners: (
      emitter: unknown,
      event: unknown,
    ): ((...args: unknown[]) => void)[] => {
      if (emitter && typeof (emitter as InstanceType<typeof EventEmitter>).listeners === "function") {
        try {
          return (emitter as InstanceType<typeof EventEmitter>).listeners(String(event)) as ((...args: unknown[]) => void)[];
        } catch { return []; }
      }
      return [];
    },

    getMaxListeners: (_emitter: unknown): number => 10,
    setMaxListeners: (_n: number, ..._emitters: unknown[]): void => {},
    listenerCount: (
      emitter: InstanceType<typeof EventEmitter>,
      eventName: string | symbol,
    ): number => emitter.listenerCount(String(eventName)),
    captureRejectionSymbol: Symbol.for("nodejs.rejection"),
    captureRejections: false,
    defaultMaxListeners: 10,
    errorMonitor: Symbol.for("events.errorMonitor"),
  };
}
