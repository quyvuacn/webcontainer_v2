import { bootstrap } from './main.js'
import { spawnSync } from './child_process_browser.js'
import { npmInstall } from './npm/install.js'
import { npmCi } from './npm/ci.js'

async function init() {
  const status = document.getElementById('status')
  try {
    const { vfs, createServer, VFS_PREFIX } = await bootstrap()
    status.textContent = 'Bootstrap OK - VFS sẵn sàng'

    const watchLog = document.getElementById('watch-log')
    vfs.watch('project', true, ev => {
      watchLog.textContent = `Watcher: ${ev.kind} ${ev.path} at ${new Date().toLocaleTimeString()}`
      if (ev.path === 'project/index.html') {
        document.getElementById('preview').contentWindow?.location?.reload?.()
      }
    })

    document.getElementById('btn-write').onclick = () => {
      const html = `<html><body>${document.getElementById('editor').value}</body></html>`
      vfs.write('project/index.html', html)
    }

    vfs.write('project/index.html', '<html><body><h1>Demo từ VFS</h1><p>F5 restore từ OPFS</p></body></html>')
    document.getElementById('preview').src = `/${VFS_PREFIX}/project/index.html`

    document.getElementById('btn-read').onclick = async () => {
      const r = await fetch(`/${VFS_PREFIX}/project/index.html`)
      const text = await r.text()
      alert(r.ok ? text : 'Not found')
    }

    document.getElementById('btn-f5').onclick = () => location.reload()

    vfs.write('project/hello.js', 'console.log("Hello from child_process!"); process.argv.forEach((a,i)=>console.log(i,a))')
    vfs.write('project/package.json', JSON.stringify({ name: 'demo', dependencies: { 'lodash': '^4.17.21' } }))

    document.getElementById('btn-npm').onclick = async () => {
      document.getElementById('npm-result').textContent = 'Đang install...'
      try {
        const r = await npmInstall(p => vfs.read(p), (p, b) => vfs.write(p, b), p => vfs.acquireLock(p), id => vfs.releaseLock(id))
        document.getElementById('npm-result').textContent = `Thêm ${r.added} packages`
      } catch (e) {
        document.getElementById('npm-result').textContent = 'Lỗi: ' + e.message
      }
    }
    document.getElementById('btn-npm-ci').onclick = async () => {
      document.getElementById('npm-result').textContent = 'Đang ci...'
      try {
        const r = await npmCi(p => vfs.read(p), (p, b) => vfs.write(p, b), p => vfs.acquireLock(p), id => vfs.releaseLock(id))
        document.getElementById('npm-result').textContent = `Ci ${r.added} packages`
      } catch (e) {
        document.getElementById('npm-result').textContent = 'Lỗi: ' + e.message
      }
    }

    document.getElementById('btn-spawn').onclick = () => {
      const r = spawnSync('project/hello.js', ['a', 'b'])
      document.getElementById('spawn-result').textContent = `status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`
    }

    document.getElementById('btn-http').onclick = async () => {
      try {
        const r = await fetch('/__port__/3000/')
        const t = await r.text()
        document.getElementById('http-result').textContent = `Status ${r.status}: ${t}`
      } catch (e) {
        document.getElementById('http-result').textContent = 'Lỗi: ' + e.message
      }
    }

    createServer((req, res) => {
      res.setHeader('Content-Type', 'text/plain')
      res.end(`Hello from http.createServer! Path: ${req.path}`)
    }).listen(3000)
    status.textContent = 'Bootstrap OK - VFS + http.createServer(3000)'
  } catch (e) {
    status.textContent = 'Lỗi: ' + e.message
  }
}

init()
