#!/usr/bin/env node
import { randomBytes } from 'crypto'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const prefix = process.env.VFS_PREFIX || '_' + randomBytes(4).toString('hex') + '_'

console.log('VFS_PREFIX:', prefix)

try {
  execSync('npm run build:vfs', { cwd: root, stdio: 'inherit' })
} catch (e) {
  console.warn('build:vfs skip (Rust/wasm-bindgen not installed):', e.message)
}
execSync('npm run build', { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_VFS_PREFIX: prefix } })

const distDir = join(root, 'dist')
const swPath = join(distDir, 'sw.js')
if (existsSync(swPath)) {
  let sw = readFileSync(swPath, 'utf8')
  sw = sw.replace(/\/__r__\//g, `/${prefix}/`).replace(/__r__/g, prefix)
  writeFileSync(swPath, sw)
  console.log('SW updated with VFS_PREFIX')
}

if (process.argv.includes('--obfuscate')) {
  try {
    const obfuscate = (p) => {
      execSync(`npx javascript-obfuscator "${p}" --output "${p}" --compact true --self-defending true`, { cwd: root, stdio: 'inherit' })
    }
    if (existsSync(swPath)) obfuscate(swPath)
    const assetsDir = join(distDir, 'assets')
    if (existsSync(assetsDir)) {
      for (const f of readdirSync(assetsDir).filter(f => f.endsWith('.js'))) {
        obfuscate(join(assetsDir, f))
      }
    }
    console.log('Obfuscation done')
  } catch (e) {
    console.warn('Obfuscation skipped (npm i -D javascript-obfuscator):', e.message)
  }
}

console.log('Build complete:', distDir)
