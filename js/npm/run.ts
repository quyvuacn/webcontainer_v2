import { CDN_BASE } from '../cdn/config'

export async function npmRun(
  scriptName: string,
  vfsRead: (p: string) => Uint8Array | null,
  spawnNode: (args: string[], opts: { cwd: string }) => Promise<number>,
  pkgPath = 'project',
  vfsWrite?: (p: string, b: Uint8Array) => void,
) {
  const pkgBytes = vfsRead(`${pkgPath}/package.json`)
  if (!pkgBytes) throw new Error('No package.json')
  const pkg = JSON.parse(new TextDecoder().decode(pkgBytes))
  const scripts = pkg.scripts || {}
  const script = scripts[scriptName] ?? (scriptName === 'start' ? scripts.start : null)
  if (!script) throw new Error(`Missing script: ${scriptName}`)

  // Prefix / so PathUtils.isAbsolute returns true in cli.ts — prevents double-cwd join
  const abs = (p: string) => p.startsWith('/') ? p : '/' + p

  // node <file> [args...]
  const nodeMatch = script.trim().match(/^node\s+(.+)$/)
  if (nodeMatch) {
    const file = nodeMatch[1].trim()
    const filePath = file.startsWith('./') ? `${pkgPath}/${file.slice(2)}` : `${pkgPath}/${file}`
    const status = await spawnNode([abs(filePath)], { cwd: pkgPath })
    return { status }
  }

  // <bin> [args...] — resolve from node_modules
  const [cmd, ...cmdArgs] = script.trim().split(/\s+/)
  const binFile = await resolveBin(cmd, pkgPath, vfsRead, vfsWrite)
  if (binFile) {
    const status = await spawnNode([abs(binFile), ...cmdArgs], { cwd: pkgPath })
    return { status }
  }

  throw new Error(`Script "${scriptName}" must be "node <file>" or a resolvable bin`)
}

async function resolveBin(
  cmd: string,
  pkgPath: string,
  vfsRead: (p: string) => Uint8Array | null,
  vfsWrite?: (p: string, b: Uint8Array) => void,
): Promise<string | null> {
  const pkgJsonBytes = vfsRead(`${pkgPath}/node_modules/${cmd}/package.json`)
  if (!pkgJsonBytes) return null

  let realPkg: { version?: string; bin?: string | Record<string, string> }
  try {
    realPkg = JSON.parse(new TextDecoder().decode(pkgJsonBytes))
  } catch { return null }

  const version = realPkg.version
  if (!version) return null

  let binRelPath: string | null = null
  if (typeof realPkg.bin === 'string') {
    binRelPath = realPkg.bin
  } else if (realPkg.bin && typeof realPkg.bin === 'object') {
    binRelPath = (realPkg.bin[cmd] ?? Object.values(realPkg.bin)[0]) as string | null
  }
  if (!binRelPath) return null

  const normalized = binRelPath.startsWith('./') ? binRelPath.slice(2) : binRelPath
  const vfsFilePath = `${pkgPath}/node_modules/${cmd}/${normalized}`

  // Bin file will be lazy-fetched by the VFS layer on first access.
  // Pre-fetch here only if vfsWrite is provided (avoids shebang in bin scripts).
  if (!vfsRead(vfsFilePath) && vfsWrite) {
    try {
      const fileRes = await fetch(`${CDN_BASE}/${cmd}@${version}/${normalized}`)
      if (!fileRes.ok) return null
      let content = await fileRes.text()
      if (content.startsWith('#!')) content = content.slice(content.indexOf('\n') + 1)
      vfsWrite(vfsFilePath, new TextEncoder().encode(content))
    } catch { return null }
  }

  return vfsFilePath
}
