import * as Path from './path.js'
import { npmInstall } from '../npm/install.js'
import { npmCi } from '../npm/ci.js'
import { npmRun } from '../npm/run.js'
import { spawnSync } from '../child_process_browser.js'

const A = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m',
}

function resolvePath(cwd, input, fallback, home = 'project') {
  if (!input) return fallback ?? cwd
  const expanded = input === '~' ? home : input.startsWith('~/') ? Path.join(home, input.slice(2)) : input
  return Path.resolve(cwd, expanded)
}

export const commands = {
  pwd: async ({ cwd, writeln }) => {
    writeln(cwd)
    return { exitCode: 0 }
  },

  cd: async ({ args, vfs, cwd, writeln, oldPwd, home }) => {
    const h = home ?? 'project'
    const raw = args[0]
    if (raw === '-') {
      if (!oldPwd) {
        writeln(A.red + 'cd: OLDPWD not set' + A.reset)
        return { exitCode: 1 }
      }
      return { newCwd: oldPwd, exitCode: 0 }
    }
    let target = resolvePath(cwd, raw, h, h)
    if (!target) target = h
    try {
      const stat = await vfs.stat(target)
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
    const pathArg = args.find(a => !a.startsWith('-'))
    const target = resolvePath(cwd, pathArg, cwd, home ?? 'project')
    try {
      const stat = await vfs.stat(target)
      if (stat.isFile()) {
        writeln(Path.basename(target))
        return { exitCode: 0 }
      }
      const entries = await vfs.readdir(target)
      const sorted = entries.sort()
      const lines = []
      for (const name of sorted) {
        if (name.startsWith('.') && !args.some(f => f.includes('a'))) continue
        try {
          const child = Path.join(target, name)
          const st = await vfs.stat(child)
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
    if (!args.length) {
      writeln(A.red + 'cat: missing operand' + A.reset)
      return { exitCode: 1 }
    }
    let exitCode = 0
    for (const arg of args) {
      const target = resolvePath(cwd, arg, undefined, home ?? 'project')
      const p = target.startsWith('/') ? target.slice(1) : target
      try {
        let content
        if (vfsRead) {
          const bytes = vfsRead(p)
          if (bytes != null) content = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)
        }
        if (content === undefined) content = await vfs.readFile(target, 'utf8')
        writeln(typeof content === 'string' ? content : new TextDecoder().decode(content))
      } catch {
        writeln(A.red + `cat: ${target}: No such file or directory` + A.reset)
        exitCode = 1
      }
    }
    return { exitCode }
  },

  mkdir: async ({ args, vfs, cwd, writeln, home }) => {
    const recursive = args.includes('-p')
    const paths = args.filter(a => !a.startsWith('-'))
    if (!paths.length) {
      writeln(A.red + 'mkdir: missing operand' + A.reset)
      return { exitCode: 1 }
    }
    for (const p of paths) {
      const target = resolvePath(cwd, p, undefined, home ?? 'project')
      try {
        await vfs.mkdir(target, { recursive })
      } catch (e) {
        writeln(A.red + `mkdir: ${e?.message ?? e}` + A.reset)
        return { exitCode: 1 }
      }
    }
    return { exitCode: 0 }
  },

  rm: async ({ args, vfs, cwd, writeln, home }) => {
    const recursive = args.some(f => /^-[Rr]f?$/.test(f))
    const paths = args.filter(a => !a.startsWith('-'))
    if (!paths.length) {
      writeln(A.red + 'rm: missing operand' + A.reset)
      return { exitCode: 1 }
    }
    for (const p of paths) {
      const target = resolvePath(cwd, p, undefined, home ?? 'project')
      try {
        const stat = await vfs.stat(target)
        if (stat.isDirectory()) {
          if (!recursive) {
            writeln(A.red + `rm: cannot remove '${target}': is a directory` + A.reset)
            return { exitCode: 1 }
          }
          await vfs.rmdir(target, { recursive: true })
        } else {
          await vfs.unlink(target)
        }
      } catch {
        writeln(A.red + `rm: cannot remove '${target}'` + A.reset)
        return { exitCode: 1 }
      }
    }
    return { exitCode: 0 }
  },

  echo: async ({ args, write, writeln }) => {
    const noNewline = args.includes('-n')
    const toPrint = args.filter(a => a !== '-n').join(' ')
    noNewline ? write(toPrint) : writeln(toPrint)
    return { exitCode: 0 }
  },

  clear: async ({ write }) => {
    write('\x1b[2J\x1b[H')
    return { exitCode: 0 }
  },

  help: async ({ writeln }) => {
    const list = [
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
    if (!args.length) {
      writeln(A.red + 'node: usage: node <file> [args...]' + A.reset)
      return { exitCode: 1 }
    }
    if (!spawnNode) {
      writeln(A.yellow + 'node: spawnNode not configured' + A.reset)
      return { exitCode: 1 }
    }
    return { exitCode: await spawnNode(args, { cwd }) }
  },

  npm: async ({ args, cwd, writeln, vfsRead, vfsWrite, vfsAcquireLock, vfsReleaseLock }) => {
    if (!args.length) {
      writeln('npm <install|ci|run|start> [args...]')
      return { exitCode: 0 }
    }
    const sub = args[0]
    try {
      if (sub === 'install' || sub === 'i') {
        const r = await npmInstall(vfsRead, vfsWrite, vfsAcquireLock, vfsReleaseLock, cwd, undefined, { prefetch: true })
        writeln(`added ${r.added} packages`)
        return { exitCode: 0 }
      }
      if (sub === 'ci') {
        const r = await npmCi(vfsRead, vfsWrite, vfsAcquireLock, vfsReleaseLock, cwd, { prefetch: true })
        writeln(`ci ${r.added} packages`)
        return { exitCode: 0 }
      }
      if (sub === 'run' || sub === 'start') {
        const script = args[1] || (sub === 'start' ? 'start' : null)
        if (!script) {
          writeln(A.red + 'npm run: missing script name' + A.reset)
          return { exitCode: 1 }
        }
        const result = npmRun(script, vfsRead, spawnSync, cwd)
        if (result.stdout) writeln(result.stdout)
        if (result.stderr) writeln(A.red + result.stderr + A.reset)
        return { exitCode: result.status ?? 1 }
      }
      writeln(A.red + `npm: unknown command ${sub}` + A.reset)
      return { exitCode: 1 }
    } catch (e) {
      writeln(A.red + `npm: ${e?.message ?? e}` + A.reset)
      return { exitCode: 1 }
    }
  },
}
