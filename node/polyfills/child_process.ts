/**
 * Node child_process polyfill — stubs that throw in browser env.
 * The webcontainer shell uses spawnNode directly, not child_process.
 */

import EventEmitter from 'eventemitter3'

class FakeChildProcess extends EventEmitter {
  pid = 0
  exitCode: number | null = null
  signalCode: string | null = null
  killed = false
  stdin = { write: () => false, end: () => {}, on: () => {} }
  stdout = new EventEmitter()
  stderr = new EventEmitter()

  kill(_signal?: string): boolean {
    return false
  }
}

const notSupported = (op: string) =>
  (..._args: unknown[]): never => {
    throw new Error(`child_process.${op}: not supported in browser. Use spawnNode for npm run.`)
  }

export function createChildProcessPolyfill() {
  return {
    spawn: (_cmd: string, _args?: string[], _opts?: Record<string, unknown>): FakeChildProcess => {
      const proc = new FakeChildProcess()
      queueMicrotask(() => {
        proc.emit('error', new Error(`child_process.spawn: not supported in browser`))
      })
      return proc
    },

    exec: (
      _cmd: string,
      optsOrCb?: Record<string, unknown> | ((err: Error | null, stdout: string, stderr: string) => void),
      cb?: (err: Error | null, stdout: string, stderr: string) => void,
    ): FakeChildProcess => {
      const callback = typeof optsOrCb === 'function' ? optsOrCb : cb
      const proc = new FakeChildProcess()
      queueMicrotask(() => {
        callback?.(new Error('child_process.exec: not supported in browser'), '', '')
      })
      return proc
    },

    execFile: (
      _file: string,
      _argsOrOptsOrCb?: unknown,
      _optsOrCb?: unknown,
      cb?: (err: Error | null, stdout: string, stderr: string) => void,
    ): FakeChildProcess => {
      const proc = new FakeChildProcess()
      queueMicrotask(() => {
        cb?.(new Error('child_process.execFile: not supported in browser'), '', '')
      })
      return proc
    },

    fork: notSupported('fork'),
    execSync: notSupported('execSync'),
    execFileSync: notSupported('execFileSync'),
    spawnSync: (_cmd: string, _args?: string[], _opts?: Record<string, unknown>) => ({
      pid: 0,
      status: 1,
      signal: null,
      output: [null, Buffer.alloc(0), Buffer.alloc(0)],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(new Error('spawnSync not supported').message.length),
      error: new Error('child_process.spawnSync: not supported in browser'),
    }),
  }
}
