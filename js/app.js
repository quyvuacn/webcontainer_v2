import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { bootstrap } from './main.js'
import { spawnSync } from './child_process_browser.js'
import { createShellVfsAdapter } from './shell/vfs_adapter.js'
import { Shell } from './shell/shell.js'
import * as Path from './shell/path.js'

async function init() {
  const title = document.getElementById('title')
  const termContainer = document.getElementById('terminal')

  const term = new Terminal({
    theme: { background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff' },
    fontFamily: '"Cascadia Code", "Fira Code", monospace',
    fontSize: 14,
    cursorBlink: true,
    scrollback: 1000,
    disableStdin: false,
  })
  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(termContainer)
  term.writeln('\x1b[2mĐang khởi động...\x1b[0m')

  function doFit() {
    requestAnimationFrame(() => {
      fitAddon.fit()
      setTimeout(() => fitAddon.fit(), 100)
    })
  }
  doFit()
  window.addEventListener('resize', () => fitAddon.fit())

  try {
    const bootstrapPromise = bootstrap()
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Bootstrap timeout (5s). F5 thử lại.')), 5000)
    )
    const { vfs, createServer } = await Promise.race([bootstrapPromise, timeout])
    title.textContent = 'Browser Node — Virtual Shell'

    term.write('\x1b[2K\x1b[1G') // clear loading line

    vfs.write('project/index.html', '<html><body><h1>Browser Node</h1><p>F5 restore từ OPFS</p></body></html>')
    vfs.write('project/hello.js', 'console.log("Hello!"); process.argv.forEach((a,i)=>console.log(i,a))')
    vfs.write('project/package.json', JSON.stringify({ name: 'demo', dependencies: { lodash: '^4.17.21' } }))
    if (!vfs.read('project/index.html')) throw new Error('VFS write/read failed')

    createServer((req, res) => {
      res.setHeader('Content-Type', 'text/plain')
      res.end(`Hello from http.createServer! Path: ${req.path}`)
    }).listen(3000)

    const shellVfs = createShellVfsAdapter(vfs)
    const spawnNode = async (args, opts) => {
      const file = Path.resolve(opts?.cwd || 'project', args[0] || '')
      const r = spawnSync(file, args.slice(1), { cwd: opts?.cwd })
      if (r.stdout) term.write(r.stdout)
      if (r.stderr) term.write('\x1b[31m' + r.stderr + '\x1b[0m')
      return r.status ?? 1
    }
    const shell = new Shell(shellVfs, t => term.write(t), {
      cwd: 'project',
      user: 'user',
      spawnNode,
      vfs,
      vfsRead: p => vfs.read(p),
      vfsWrite: (p, b) => vfs.write(p, b),
      vfsAcquireLock: p => vfs.acquireLock(p),
      vfsReleaseLock: id => vfs.releaseLock(id),
    })

    term.writeln('\x1b[1;34m╔═══════════════════════════════════════╗\x1b[0m')
    term.writeln('\x1b[1;34m║   \x1b[1;32mBrowser Node Shell\x1b[1;34m                 ║\x1b[0m')
    term.writeln('\x1b[1;34m║   \x1b[2mVirtual FS in browser\x1b[1;34m                 ║\x1b[0m')
    term.writeln('\x1b[1;34m╚═══════════════════════════════════════╝\x1b[0m')
    term.writeln('')
    term.writeln('Gõ \x1b[33mhelp\x1b[0m xem lệnh.')
    term.writeln('')
    term.write(shell.getPrompt())
    doFit()

    let lineBuffer = ''
    let cursorIndex = 0
    const history = []
    let historyIdx = -1

    function redrawLine() {
      term.write('\r\x1b[K' + shell.getPrompt() + lineBuffer)
      if (cursorIndex < lineBuffer.length) term.write(`\x1b[${lineBuffer.length - cursorIndex}D`)
    }

    function handleData(data) {
      if (data === '\r' || data === '\n') {
        term.write('\r\n')
        const line = lineBuffer.trim()
        if (line) history.unshift(line)
        historyIdx = -1
        shell.execute(lineBuffer).then(() => {
          lineBuffer = ''
          cursorIndex = 0
          term.write(shell.getPrompt())
        })
        return
      }
      if (data === '\x7f' || data === '\b') {
        if (cursorIndex > 0) {
          lineBuffer = lineBuffer.slice(0, cursorIndex - 1) + lineBuffer.slice(cursorIndex)
          cursorIndex--
          term.write('\b\x1b[P')
        }
        return
      }
      if (data === '\x03') {
        term.write('^C\r\n')
        lineBuffer = ''
        cursorIndex = 0
        term.write(shell.getPrompt())
        return
      }
      if (data === '\x0c') {
        term.write('\x1b[2J\x1b[H')
        redrawLine()
        return
      }
      if (data === '\t') {
        shell.complete(lineBuffer).then(({ completions, replaceFrom, replaceTo }) => {
          if (!completions.length) { term.write('\x07'); return }
          const prefix = lineBuffer.substring(replaceFrom, replaceTo)
          if (completions.length === 1) {
            lineBuffer = lineBuffer.slice(0, replaceFrom) + completions[0] + lineBuffer.slice(replaceTo)
            cursorIndex = replaceFrom + completions[0].length
            term.write('\b \b'.repeat(prefix.length) + completions[0])
          } else {
            const common = completions.reduce((a, b) => {
              let i = 0
              while (i < a.length && i < b.length && a[i] === b[i]) i++
              return a.slice(0, i)
            }, completions[0] || '')
            if (common.length > prefix.length) {
              lineBuffer = lineBuffer.slice(0, replaceFrom) + common + lineBuffer.slice(replaceTo)
              cursorIndex = replaceFrom + common.length
              term.write('\b \b'.repeat(prefix.length) + common)
            }
          }
        })
        return
      }
      if (data === '\x1b[D' || data === '\x1bOD') {
        if (cursorIndex > 0) { cursorIndex--; term.write('\x1b[D') }
        return
      }
      if (data === '\x1b[C' || data === '\x1bOC') {
        if (cursorIndex < lineBuffer.length) { cursorIndex++; term.write('\x1b[C') }
        return
      }
      if (data === '\x1b[H' || data === '\x1b[1~' || data === '\x01') {
        if (cursorIndex > 0) {
          term.write(`\x1b[${cursorIndex}D`)
          cursorIndex = 0
        }
        return
      }
      if (data === '\x1b[F' || data === '\x1b[4~' || data === '\x05') {
        if (cursorIndex < lineBuffer.length) {
          const n = lineBuffer.length - cursorIndex
          cursorIndex = lineBuffer.length
          term.write(`\x1b[${n}C`)
        }
        return
      }
      if (data === '\x1b[A' || data === '\x1bOA') {
        if (history.length && historyIdx < history.length - 1) {
          historyIdx = Math.min(historyIdx + 1, history.length - 1)
          lineBuffer = history[historyIdx] ?? ''
          cursorIndex = lineBuffer.length
          redrawLine()
        }
        return
      }
      if (data === '\x1b[B' || data === '\x1bOB') {
        if (historyIdx > 0) {
          historyIdx--
          lineBuffer = history[historyIdx] ?? ''
          cursorIndex = lineBuffer.length
          redrawLine()
        } else if (historyIdx === 0) {
          historyIdx = -1
          lineBuffer = ''
          cursorIndex = 0
          redrawLine()
        }
        return
      }
      if (data.startsWith('\x1b')) return

      if (cursorIndex === lineBuffer.length) {
        lineBuffer += data
        cursorIndex += data.length
        term.write(data)
      } else {
        lineBuffer = lineBuffer.slice(0, cursorIndex) + data + lineBuffer.slice(cursorIndex)
        cursorIndex += data.length
        redrawLine()
      }
    }

    term.onData(handleData)
    term.focus()
    termContainer.addEventListener('click', () => term.focus())
    window.addEventListener('focus', () => term.focus())
  } catch (e) {
    term.writeln('\x1b[31mLỗi: ' + (e?.message ?? e) + '\x1b[0m')
    term.writeln('Nhấn F5 để thử lại.')
    title.textContent = 'Lỗi: ' + e.message
    term.focus()
  }
}

init()
