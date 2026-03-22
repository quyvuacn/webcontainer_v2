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
        emitter.once(String(eventName), (...args: unknown[]) => resolve(args));
        emitter.once("error", reject);
      }),
    getEventListeners: (
      _emitter: unknown,
      _event: unknown,
    ): ((...args: unknown[]) => void)[] => [],
    getMaxListeners: (_emitter: unknown): number => 10,
    setMaxListeners: (_n: number, ..._emitters: unknown[]): void => {},
    listenerCount: (
      emitter: InstanceType<typeof EventEmitter>,
      eventName: string | symbol,
    ): number => emitter.listenerCount(String(eventName)),
    on: (_emitter: unknown, _event: unknown): AsyncIterable<unknown[]> => {
      throw new Error("events.on() not supported");
    },
    captureRejectionSymbol: Symbol.for("nodejs.rejection"),
    captureRejections: false,
    defaultMaxListeners: 10,
    errorMonitor: Symbol.for("events.errorMonitor"),
  };
}
