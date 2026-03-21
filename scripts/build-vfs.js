#!/usr/bin/env node
/**
 * Build VFS WASM from Rust.
 * Requires: rustup, wasm-bindgen-cli (cargo install wasm-bindgen-cli)
 * Alternative: wasm-pack (cargo install wasm-pack)
 */
import { execSync, spawnSync } from 'child_process'
import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const out = join(root, 'public', 'runtime')
const wasmPath = join(root, 'target', 'wasm32-unknown-unknown', 'release', 'vfs.wasm')

mkdirSync(out, { recursive: true })

function run(cmd, argsOrOpts, opts = {}) {
  if (Array.isArray(argsOrOpts)) {
    return spawnSync(cmd, argsOrOpts, { cwd: root, stdio: 'inherit', ...opts })
  }
  return spawnSync(cmd, { shell: true, cwd: root, stdio: argsOrOpts?.stdio ?? 'inherit', ...argsOrOpts })
}

function hasCommand(cmd) {
  const r = spawnSync(cmd, ['--version'], { shell: true, stdio: 'ignore', cwd: root })
  return r.status === 0
}

run('rustup target add wasm32-unknown-unknown', { stdio: 'pipe' })
const build = run('cargo build --target wasm32-unknown-unknown --release')
if (build.status !== 0) process.exit(build.status)

if (!existsSync(wasmPath)) {
  console.error('WASM output not found:', wasmPath)
  process.exit(1)
}

if (hasCommand('wasm-bindgen')) {
  execSync(
    `wasm-bindgen "${wasmPath}" --out-dir "${out}" --target web --out-name vfs_ram`,
    { cwd: root, stdio: 'inherit' }
  )
} else if (hasCommand('wasm-pack')) {
  const r = run('wasm-pack', ['build', '--target', 'web', '--out-dir', out, '--out-name', 'vfs_ram', '--no-opt'])
  if (r.status !== 0) process.exit(r.status)
} else {
  console.error('Need: cargo install wasm-bindgen-cli (or wasm-pack)')
  process.exit(1)
}

const snippetsDir = join(out, 'snippets')
if (existsSync(snippetsDir)) {
  const reexport = "export { initOpfsBridge, opfsWrite, opfsRead, opfsListAll, opfsDelete, createBroadcastChannel } from '/js/opfs_bridge.js'"
  for (const name of readdirSync(snippetsDir)) {
    const bridgePath = join(snippetsDir, name, 'js', 'opfs_bridge.js')
    if (existsSync(bridgePath)) {
      writeFileSync(bridgePath, reexport + '\n')
    }
  }
}

console.log('VFS WASM done:', join(out, 'vfs_ram.js'))
