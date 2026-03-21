import * as Path from './path'
import { npmInstall } from '../npm/install'
import { npmCi } from '../npm/ci'
import { npmRun } from '../npm/run'

const A = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m',
}

function resolvePath(cwd: string, input: string | undefined, fallback: string | undefined, home = 'project') {
  if (!input) return fallback ?? cwd
  const expanded = input === '~' ? home : input.startsWith('~/') ? Path.join(home, input.slice(2)) : input
  return Path.resolve(cwd, expanded)
}

export const commands: Record<string, (ctx: Record<string, unknown>) => Promise<{ exitCode: number; newCwd?: string }>> = {
  pwd: async ({ cwd, writeln }) => {
    writeln(cwd as string)
    return { exitCode: 0 }
  },

  cd: async ({ args, vfs, cwd, writeln, oldPwd, home }) => {
    const h = (home as string) ?? 'project'
    const raw = (args as string[])[0]
    if (raw === '-') {
      if (!oldPwd) {
        writeln(A.red + 'cd: OLDPWD not set' + A.reset)
        return { exitCode: 1 }
      }
      return { newCwd: oldPwd as string, exitCode: 0 }
    }
    let target = resolvePath(cwd as string, raw, h, h)
    if (!target) target = h
    try {
      const stat = await (vfs as { stat: (p: string) => Promise<{ isDirectory: () => boolean }> }).stat(target)
      if (!stat.isDirectory()) {
        writeln(A.red + `cd: not a directory: ${target}` + A.reset)
        return { exitCode: 1 }
      }
      return { newCwd: target, exitCode: 0 }
    } catch {
      writeln(A.red + `cd: no such file or directory: ${target}` + A.reset)
      return { exitCode: 1 }
    }
  },

  ls: async ({ args, vfs, cwd, writeln, home }) => {
    const pathArg = (args as string[]).find(a => !a.startsWith('-'))
    const target = resolvePath(cwd as string, pathArg, cwd as string, (home as string) ?? 'project')
    try {
      const stat = await (vfs as { stat: (p: string) => Promise<{ isFile: () => boolean; isDirectory: () => boolean }> }).stat(target)
      if (stat.isFile()) {
        writeln(Path.basename(target))
        return { exitCode: 0 }
      }
      const entries = await (vfs as { readdir: (p: string) => Promise<string[]> }).readdir(target)
      const sorted = entries.sort()
      const lines: string[] = []
      for (const name of sorted) {
        if (name.startsWith('.') && !(args as string[]).some(f => f.includes('a'))) continue
        try {
          const child = Path.join(target, name)
          const st = await (vfs as { stat: (p: string) => Promise<{ isDirectory: () => boolean }> }).stat(child)
          const display = st.isDirectory() ? A.blue + A.bold + name + '/' + A.reset : name
          lines.push(display)
        } catch {
          lines.push(name)
        }
      }
      writeln(lines.join('  '))
      return { exitCode: 0 }
    } catch {
      writeln(A.red + `ls: cannot access '${target}': No such file or directory` + A.reset)
      return { exitCode: 1 }
    }
  },

  cat: async ({ args, vfs, vfsRead, cwd, writeln, home }) => {
    if (!(args as string[]).length) {
      writeln(A.red + 'cat: missing operand' + A.reset)
      return { exitCode: 1 }
    }
    let exitCode = 0
    for (const arg of args as string[]) {
      const target = resolvePath(cwd as string, arg, undefined, (home as string) ?? 'project')
      const p = target.startsWith('/') ? target.slice(1) : target
      try {
        let content: string | undefined
        if (vfsRead) {
          const bytes = (vfsRead as (p: string) => Uint8Array | null)(p)
          if (bytes != null) content = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)
        }
        if (content === undefined) content = await (vfs as { readFile: (p: string, enc: string) => Promise<string> }).readFile(target, 'utf8')
        writeln(typeof content === 'string' ? content : new TextDecoder().decode(content))
      } catch {
        writeln(A.red + `cat: ${target}: No such file or directory` + A.reset)
        exitCode = 1
      }
    }
    return { exitCode }
  },

  mkdir: async ({ args, vfs, cwd, writeln, home }) => {
    const recursive = (args as string[]).includes('-p')
    const paths = (args as string[]).filter(a => !a.startsWith('-'))
    if (!paths.length) {
      writeln(A.red + 'mkdir: missing operand' + A.reset)
      return { exitCode: 1 }
    }
    for (const p of paths) {
      const target = resolvePath(cwd as string, p, undefined, (home as string) ?? 'project')
      try {
        await (vfs as { mkdir: (p: string, opts: { recursive?: boolean }) => Promise<void> }).mkdir(target, { recursive })
      } catch (e) {
        writeln(A.red + `mkdir: ${(e as Error)?.message ?? e}` + A.reset)
        return { exitCode: 1 }
      }
    }
    return { exitCode: 0 }
  },

  rm: async ({ args, vfs, cwd, writeln, home }) => {
    const recursive = (args as string[]).some(f => /^-[Rr]f?$/.test(f))
    const paths = (args as string[]).filter(a => !a.startsWith('-'))
    if (!paths.length) {
      writeln(A.red + 'rm: missing operand' + A.reset)
      return { exitCode: 1 }
    }
    for (const p of paths) {
      const target = resolvePath(cwd as string, p, undefined, (home as string) ?? 'project')
      try {
        const stat = await (vfs as { stat: (p: string) => Promise<{ isDirectory: () => boolean }> }).stat(target)
        if (stat.isDirectory()) {
          if (!recursive) {
            writeln(A.red + `rm: cannot remove '${target}': is a directory` + A.reset)
            return { exitCode: 1 }
          }
          await (vfs as { rmdir: (p: string, opts: { recursive: boolean }) => Promise<void> }).rmdir(target, { recursive: true })
        } else {
          await (vfs as { unlink: (p: string) => Promise<void> }).unlink(target)
        }
      } catch {
        writeln(A.red + `rm: cannot remove '${target}'` + A.reset)
        return { exitCode: 1 }
      }
    }
    return { exitCode: 0 }
  },

  echo: async ({ args, write, writeln }) => {
    const noNewline = (args as string[]).includes('-n')
    const toPrint = (args as string[]).filter(a => a !== '-n').join(' ')
    noNewline ? (write as (s: string) => void)(toPrint) : (writeln as (s: string) => void)(toPrint)
    return { exitCode: 0 }
  },

  clear: async ({ write }) => {
    (write as (s: string) => void)('\x1b[2J\x1b[H')
    return { exitCode: 0 }
  },

  help: async ({ writeln }) => {
    const list: [string, string][] = [
      ['pwd', 'print working directory'],
      ['cd [dir]', 'change directory'],
      ['ls [-a] [dir]', 'list directory'],
      ['cat <file>', 'print file'],
      ['mkdir [-p] <dir>', 'create directory'],
      ['rm [-rf] <path>', 'remove'],
      ['echo [args]', 'print'],
      ['node <file>', 'run JS file'],
      ['npm install', 'npm ci', 'npm run <script>'],
      ['clear', 'clear terminal'],
      ['help', 'show help'],
    ]
    writeln(A.bold + A.cyan + 'Commands:' + A.reset)
    for (const [cmd, desc] of list) {
      writeln('  ' + (cmd ?? '').padEnd(20) + (desc ?? ''))
    }
    return { exitCode: 0 }
  },

  node: async ({ args, cwd, writeln, spawnNode }) => {
    if (!(args as string[]).length) {
      writeln(A.red + 'node: usage: node <file> [args...]' + A.reset)
      return { exitCode: 1 }
    }
    if (!spawnNode) {
      writeln(A.yellow + 'node: spawnNode not configured' + A.reset)
      return { exitCode: 1 }
    }
    return { exitCode: await (spawnNode as (a: string[], o: { cwd: string }) => Promise<number>)(args as string[], { cwd: cwd as string }) }
  },

  npm: async ({ args, cwd, writeln, vfsRead, vfsWrite, vfsAcquireLock, vfsReleaseLock, spawnSyncAsync }) => {
    if (!(args as string[]).length) {
      writeln('npm <install|ci|run|start> [args...]')
      return { exitCode: 0 }
    }
    const sub = (args as string[])[0]
    try {
      if (sub === 'install' || sub === 'i') {
        const r = await npmInstall(vfsRead as (p: string) => Uint8Array | null, vfsWrite as (p: string, b: Uint8Array) => void, vfsAcquireLock as (p: string) => number, vfsReleaseLock as (id: number) => void, cwd as string, undefined, { prefetch: true })
        writeln(`added ${r.added} packages`)
        return { exitCode: 0 }
      }
      if (sub === 'ci') {
        const r = await npmCi(vfsRead as (p: string) => Uint8Array | null, vfsWrite as (p: string, b: Uint8Array) => void, vfsAcquireLock as (p: string) => number, vfsReleaseLock as (id: number) => void, cwd as string, { prefetch: true })
        writeln(`ci ${r.added} packages`)
        return { exitCode: 0 }
      }
      if (sub === 'run' || sub === 'start') {
        const script = (args as string[])[1] || (sub === 'start' ? 'start' : null)
        if (!script) {
          writeln(A.red + 'npm run: missing script name' + A.reset)
          return { exitCode: 1 }
        }
        if (!spawnSyncAsync) throw new Error('spawnSyncAsync not configured')
        const result = await npmRun(script, vfsRead as (p: string) => Uint8Array | null, spawnSyncAsync as (f: string, a: string[], o: { cwd: string }) => Promise<{ status?: number; stdout: string; stderr: string }>, cwd as string)
        if (result.stdout) writeln(result.stdout)
        if (result.stderr) writeln(A.red + result.stderr + A.reset)
        return { exitCode: result.status ?? 1 }
      }
      writeln(A.red + `npm: unknown command ${sub}` + A.reset)
      return { exitCode: 1 }
    } catch (e) {
      writeln(A.red + `npm: ${(e as Error)?.message ?? e}` + A.reset)
      return { exitCode: 1 }
    }
  },
}
