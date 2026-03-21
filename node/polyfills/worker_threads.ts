/**
 * Node worker_threads polyfill — stub for browser (Worker requires async VFS load).
 */

export function createWorkerThreadsPolyfill(): Record<string, unknown> {
  const WorkerStub = class Worker {
    constructor(_filename: string, _options?: Record<string, unknown>) {
      throw new Error('worker_threads.Worker not fully supported in browser — VFS requires async read')
    }
    postMessage(_data: unknown) {}
    terminate() {}
  }

  return {
    Worker: WorkerStub,
    isMainThread: true,
    parentPort: null,
    workerData: null,
    threadId: 0,
    receiveMessageOnPort: () => null,
    MessageChannel: globalThis.MessageChannel,
    MessagePort: globalThis.MessagePort,
  }
}
