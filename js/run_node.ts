import { runNode } from '../node/cli'
import { createVirtualFSAdapter } from '../node/vfs/core/adapter'

export function createNodeRunner(rawVfs: unknown, terminal: unknown) {
  const vfs = createVirtualFSAdapter(rawVfs)
  return async (args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) => {
    return runNode(args, vfs, terminal, { cwd: opts.cwd, env: opts.env })
  }
}

export function createSpawnSyncAsync(rawVfs: unknown) {
  const vfs = createVirtualFSAdapter(rawVfs)
  return async (filePath: string, args: string[] = [], opts: { cwd?: string; env?: Record<string, string> } = {}) => {
    const out: string[] = [], err: string[] = []
    const terminal = {
      write: (t: string) => out.push(t),
      writeError: (t: string) => err.push(t),
    }
    const cwd = opts.cwd || 'project'
    const entry = filePath.startsWith('/') ? filePath : '/' + filePath
    const status = await runNode([entry, ...args], vfs, terminal, { cwd, env: opts.env })
    return { stdout: out.join(''), stderr: err.join(''), status }
  }
}
