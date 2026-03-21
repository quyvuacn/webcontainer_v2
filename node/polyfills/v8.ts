/**
 * Stub for node:v8 — V8 engine APIs. Not available in browser.
 */

export function createV8Polyfill(): Record<string, unknown> {
  return {
    getHeapStatistics: () => ({}),
    getHeapSpaceStatistics: () => [],
    getHeapSnapshot: () => ({}),
    writeHeapSnapshot: () => '',
    getHeapCodeStatistics: () => ({}),
    setFlagsFromString: () => {},
    serialize: () => new ArrayBuffer(0),
    deserialize: () => ({}),
    cachedDataVersionTag: () => 0,
    getHeapSnapshotSync: () => ({}),
    Serializer: class {},
    Deserializer: class {},
    DefaultDeserializer: class {},
    DefaultSerializer: class {},
  }
}
