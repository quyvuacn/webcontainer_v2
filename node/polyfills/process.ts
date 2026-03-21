/**
 * Node process polyfill — env, argv, cwd, stdout/stderr/stdin, signals.
 */

import { PathUtils } from '../vfs/core/path'
import EventEmitter from 'eventemitter3'

export interface TerminalLike {
  write: (text: string) => void
  writeError?: (text: string) => void
}

export class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`Process exited with code ${code}`)
    this.name = 'ProcessExitError'
  }
}

class ProcessStream extends EventEmitter {
  readonly isTTY: boolean
  columns = 80
  rows = 24
  fd: number

  constructor(
    isTTY: boolean,
    fd: number,
    private _write: (s: string) => void,
  ) {
    super()
    this.isTTY = isTTY
    this.fd = fd
  }

  write(s: string | Uint8Array, _encoding?: string, cb?: (err?: Error) => void): boolean {
    this._write(String(s).replace(/\r?\n/g, '\r\n'))
    cb?.()
    return true
  }

  end(_chunk?: unknown, _encoding?: unknown, cb?: () => void): this {
    cb?.()
    return this
  }

  // TTY cursor control — CLI uses these to clear/redraw the terminal
  cursorTo(x: number, _y?: number, cb?: () => void): boolean {
    if (this.isTTY) this._write(`\x1b[${x + 1}G`)
    cb?.()
    return true
  }

  moveCursor(dx: number, dy: number, cb?: () => void): boolean {
    if (this.isTTY) {
      if (dx > 0) this._write(`\x1b[${dx}C`)
      else if (dx < 0) this._write(`\x1b[${-dx}D`)
      if (dy > 0) this._write(`\x1b[${dy}B`)
      else if (dy < 0) this._write(`\x1b[${-dy}A`)
    }
    cb?.()
    return true
  }

  clearLine(dir: number, cb?: () => void): boolean {
    if (this.isTTY) {
      if (dir === 0) this._write('\x1b[2K')
      else if (dir === 1) this._write('\x1b[1K')
      else this._write('\x1b[0K')
    }
    cb?.()
    return true
  }

  clearScreenDown(cb?: () => void): boolean {
    if (this.isTTY) this._write('\x1b[0J')
    cb?.()
    return true
  }

  setRawMode(_mode: boolean): this {
    return this
  }

  resume(): this {
    return this
  }

  pause(): this {
    return this
  }

  setEncoding(_enc: string): this {
    return this
  }

  pipe<T>(dest: T): T {
    return dest
  }

  read(): null {
    return null
  }

  destroy(): this {
    return this
  }
}

export class ProcessPolyfill {
  env: Record<string, string>
  argv: string[]
  argv0 = 'node'
  execPath = '/usr/local/bin/node'
  execArgv: string[] = []
  platform = 'linux' as const
  arch = 'x64'
  version = 'v20.11.0'
  versions: Record<string, string> = {
    node: '20.11.0',
    v8: '10.2.154.26',
    uv: '1.45.0',
    zlib: '1.2.13',
    ares: '1.19.1',
    modules: '115',
    nghttp2: '1.52.0',
    napi: '9',
    llhttp: '8.1.0',
    openssl: '3.0.11',
    cldr: '42.0',
    icu: '72.1',
    tz: '2023c',
    unicode: '15.0',
  }
  title = 'node'
  pid = 1
  ppid = 0
  connected = false
  debugPort = 9229

  private _cwd: string
  private _ee = new EventEmitter()

  stdout: ProcessStream
  stderr: ProcessStream
  stdin: ProcessStream

  constructor(
    cwd: string,
    argv: string[],
    env: Record<string, string>,
    terminal: TerminalLike,
  ) {
    this._cwd = PathUtils.normalize(cwd)
    this.argv = argv
    this.env = env
    this.stdout = new ProcessStream(true, 1, (s) => terminal.write(s))
    this.stderr = new ProcessStream(true, 2, (s) => (terminal.writeError ?? terminal.write)(s))
    this.stdin = new ProcessStream(false, 0, () => {})
  }

  cwd = (): string => this._cwd

  chdir = (dir: string): void => {
    this._cwd = PathUtils.join(this._cwd, dir)
  }

  exit = (code = 0): never => {
    const r = (globalThis as { __wcExitResolve?: (c: number) => void }).__wcExitResolve
    if (r) {
      r(code)
      delete (globalThis as { __wcExitResolve?: (c: number) => void }).__wcExitResolve
    }
    throw new ProcessExitError(code)
  }

  nextTick = (fn: (...args: unknown[]) => void, ...args: unknown[]): void => {
    queueMicrotask(() => fn(...args))
  }

  hrtime = Object.assign(
    (prev?: [number, number]): [number, number] => {
      const nowMs = performance.now()
      const sec = Math.floor(nowMs / 1000)
      const ns = Math.floor((nowMs % 1000) * 1_000_000)
      if (prev) return [sec - prev[0], ns - prev[1]]
      return [sec, ns]
    },
    {
      bigint: (): bigint => {
        return BigInt(Math.floor(performance.now() * 1_000_000))
      },
    },
  )

  on = (event: string, fn: (...args: unknown[]) => void): this => {
    this._ee.on(event, fn)
    return this
  }

  once = (event: string, fn: (...args: unknown[]) => void): this => {
    this._ee.once(event, fn)
    return this
  }

  off = (event: string, fn: (...args: unknown[]) => void): this => {
    this._ee.off(event, fn)
    return this
  }

  removeListener = (event: string, fn: (...args: unknown[]) => void): this => {
    return this.off(event, fn)
  }

  addListener = (event: string, fn: (...args: unknown[]) => void): this => {
    return this.on(event, fn)
  }

  emit = (event: string, ...args: unknown[]): boolean => {
    return this._ee.emit(event, ...args)
  }

  removeAllListeners = (event?: string): this => {
    this._ee.removeAllListeners(event)
    return this
  }

  listenerCount = (event: string): number => {
    return this._ee.listenerCount(event)
  }

  listeners = (event: string): ((...args: unknown[]) => void)[] => {
    return (this._ee as { listeners: (e: string) => ((...args: unknown[]) => void)[] }).listeners(event)
  }

  eventNames = (): (string | symbol)[] => {
    return this._ee.eventNames()
  }

  setMaxListeners = (_n: number): this => this

  getMaxListeners = (): number => 10

  memoryUsage = (): { rss: number; heapTotal: number; heapUsed: number; external: number; arrayBuffers: number } => ({
    rss: 0,
    heapTotal: 0,
    heapUsed: 0,
    external: 0,
    arrayBuffers: 0,
  })

  cpuUsage = (_prev?: { user: number; system: number }): { user: number; system: number } => ({
    user: 0,
    system: 0,
  })

  resourceUsage = (): Record<string, number> => ({})

  uptime = (): number => performance.now() / 1000

  kill = (_pid: number, _signal?: string): void => {}

  send = (_message: unknown, _cb?: (err: Error | null) => void): boolean => false

  disconnect = (): void => {}

  setUncaughtExceptionCaptureCallback = (_fn: ((err: Error) => void) | null): void => {}
  hasUncaughtExceptionCaptureCallback = (): boolean => false

  binding = (_name: string): unknown => ({})
  dlopen = (): void => {}

  getegid = (): number => 1000
  geteuid = (): number => 1000
  getgid = (): number => 1000
  getuid = (): number => 1000
  getgroups = (): number[] => [1000]

  umask = (mask?: number): number => mask ?? 0o022

  allowedNodeEnvironmentFlags: Set<string> = new Set()
  channel: unknown = null
  report: unknown = null
}
