/**
 * NodeExecutor — main-thread entry point. Runs in same context as VFS.
 */

import { PathUtils } from '../vfs/core/path'
import type { VirtualFS } from '../vfs/core/vfs'
import type { NodeExecutorOptions, ExecutionResult } from '../types'
import { ModuleResolver } from '../module-system/resolver'
import { ModuleCache } from '../module-system/cache'
import { CJSLoader } from '../module-system/cjs-loader'
import { createBuiltinMap } from '../module-system/builtins'
import { ProcessPolyfill, ProcessExitError } from '../polyfills/process'
import type { TerminalLike } from '../polyfills/process'

export class NodeExecutor {
  constructor(
    private vfs: VirtualFS,
    private terminal: TerminalLike,
  ) {}

  /**
   * Run a file. Returns ExecutionResult.
   */
  async run(filePath: string, options: NodeExecutorOptions = { cwd: '/' }): Promise<ExecutionResult> {
    const cwd = PathUtils.normalize(options.cwd)
    const argv = options.argv ?? ['node', filePath]
    const env = options.env ?? {}

    const absolute = PathUtils.isAbsolute(filePath)
      ? PathUtils.normalize(filePath)
      : PathUtils.join(cwd, filePath)

    if (!(await this.vfs.exists(absolute))) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `node: cannot open ${filePath}: No such file or directory\n`,
      }
    }

    const stdout: string[] = []
    const stderr: string[] = []
    const terminal: TerminalLike = {
      write: (t) => stdout.push(t),
      writeError: (t) => stderr.push(t),
    }

    const process = new ProcessPolyfill(cwd, argv, env, terminal)
    const resolver = new ModuleResolver(this.vfs)
    const cache = new ModuleCache()
    const syncCache = new Map<string, string | Uint8Array>()
    const builtins = createBuiltinMap(this.vfs, process, () => process.cwd(), syncCache)
    const loader = new CJSLoader(this.vfs, resolver, cache, builtins, process, syncCache)

    try {
      await loader.run(absolute, cwd)
      return {
        exitCode: 0,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
      }
    } catch (err) {
      if (err instanceof ProcessExitError) {
        return {
          exitCode: err.code,
          stdout: stdout.join(''),
          stderr: stderr.join(''),
        }
      }
      const msg = err instanceof Error ? err.stack ?? err.message : String(err)
      stderr.push(`${msg}\n`)
      return {
        exitCode: 1,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }
  }
}
