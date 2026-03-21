import { parseCommandChain, parseCommand } from './parser.js'
import { commands } from './commands.js'
import * as Path from './path.js'

const A = { reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', blue: '\x1b[34m', dim: '\x1b[2m' }

export class Shell {
  constructor(vfs, write, opts = {}) {
    this.vfs = vfs
    this.write = write
    this.cwd = opts.cwd ?? 'project'
    this.home = opts.home ?? 'project'
    this.user = opts.user ?? 'user'
    this.oldPwd = null
    this.spawnNode = opts.spawnNode
    this.vfsRead = opts.vfsRead
    this.vfsWrite = opts.vfsWrite
    this.vfsAcquireLock = opts.vfsAcquireLock
    this.vfsReleaseLock = opts.vfsReleaseLock
  }

  getPrompt() {
    const dir = this.cwd === this.home ? '~' : this.cwd
    return A.bold + A.green + this.user + A.reset + A.dim + '@' + A.reset + A.green + 'browser-node' + A.reset + ':' + A.bold + A.blue + dir + A.reset + '$ '
  }

  getCwd() {
    return this.cwd
  }

  async execute(line) {
    const parts = parseCommandChain(line)
    if (!parts?.length) return
    let lastExitCode = 0
    for (const part of parts) {
      if (!part.line) continue
      lastExitCode = await this.executeOne(part.line)
      if (part.op === ';') continue
      if (part.op === '&&' && lastExitCode !== 0) break
      if (part.op === '||' && lastExitCode === 0) break
    }
  }

  async executeOne(line) {
    const parsed = parseCommand(line)
    if (!parsed) return 0

    const handler = commands[parsed.cmd]
    if (!handler) {
      const scriptResult = await this.tryRunScript(parsed.cmd, parsed.args, parsed.redirect)
      if (scriptResult) return 0
      this.write(A.reset + '\x1b[31m' + parsed.cmd + ': command not found\x1b[0m\r\n')
      return 127
    }

    const writeln = (t) => this.write(t + '\r\n')
    const ctx = {
      args: parsed.args,
      vfs: this.vfs,
      cwd: this.cwd,
      home: this.home,
      user: this.user,
      write: this.write,
      writeln,
      oldPwd: this.oldPwd,
      spawnNode: this.spawnNode,
      vfsRead: this.vfsRead,
      vfsWrite: this.vfsWrite,
      vfsAcquireLock: this.vfsAcquireLock,
      vfsReleaseLock: this.vfsReleaseLock,
    }

    try {
      let result
      if (parsed.redirect) {
        const chunks = []
        const rCtx = { ...ctx, write: t => chunks.push(t), writeln: t => chunks.push(t + '\n') }
        result = await handler(rCtx)
        const outPath = Path.resolve(this.cwd, parsed.redirect.path)
        const content = chunks.join('')
        if (parsed.redirect.append) {
          const existing = await this.vfs.readFile(outPath, 'utf8').catch(() => '')
          await this.vfs.writeFile(outPath, (existing || '') + content)
        } else {
          await this.vfs.writeFile(outPath, content)
        }
      } else {
        result = await handler(ctx)
      }

      if (result.newCwd) {
        this.oldPwd = this.cwd
        this.cwd = result.newCwd
      }
      return result.exitCode ?? 0
    } catch (e) {
      this.write('\x1b[31merror: ' + (e?.message ?? e) + '\x1b[0m\r\n')
      return 1
    }
  }

  async tryRunScript(cmd, args, redirect) {
    const scriptPath = Path.resolve(this.cwd, cmd)
    try {
      const stat = await this.vfs.stat(scriptPath)
      if (stat.isDirectory()) return false

      const ext = Path.extname(scriptPath).toLowerCase()
      if (ext === '.js' && this.spawnNode) {
        await this.spawnNode([scriptPath, ...args], { cwd: this.cwd })
        return true
      }
    } catch {}
    return false
  }

  async complete(line) {
    const trimmed = line.trim()
    const tokens = trimmed.split(/\s+/)
    const lastToken = tokens[tokens.length - 1] ?? ''
    const isCmd = tokens.length <= 1

    if (isCmd) {
      const prefix = lastToken.toLowerCase()
      const candidates = Object.keys(commands).filter(c => c.startsWith(prefix))
      const m = line.match(/\S+$/)
      const start = m ? m.index : line.length
      const end = m ? start + m[0].length : line.length
      return { completions: candidates, replaceFrom: start, replaceTo: end }
    }

    const pathInput = lastToken || '.'
    const expanded = pathInput === '~' ? this.home : pathInput.startsWith('~/') ? Path.join(this.home, pathInput.slice(2)) : pathInput
    const resolved = Path.resolve(this.cwd, expanded)
    const parentDir = pathInput.endsWith('/') ? resolved : Path.dirname(resolved)
    const prefix = Path.basename(expanded)

    try {
      const entries = await this.vfs.readdir(parentDir)
      const matches = entries
        .filter(n => n.toLowerCase().startsWith(prefix.toLowerCase()))
        .map(n => {
          const full = Path.join(parentDir, n)
          return this.vfs.stat(full).then(st => st.isDirectory() ? n + '/' : n).catch(() => n)
        })
      const resolved_ = await Promise.all(matches)
      const m = line.match(/\S+$/)
      const start = m ? m.index : line.length
      const end = m ? start + m[0].length : line.length
      return { completions: resolved_.sort(), replaceFrom: start, replaceTo: end }
    } catch {
      return { completions: [], replaceFrom: line.length, replaceTo: line.length }
    }
  }
}
