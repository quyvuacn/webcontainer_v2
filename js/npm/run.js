export async function npmRun(scriptName, vfsRead, spawnSyncAsync, pkgPath = 'project') {
  const pkgBytes = vfsRead(`${pkgPath}/package.json`)
  if (!pkgBytes) throw new Error('No package.json')
  const pkg = JSON.parse(new TextDecoder().decode(pkgBytes))
  const scripts = pkg.scripts || {}
  const script = scripts[scriptName] ?? (scriptName === 'start' ? scripts.start : null)
  if (!script) throw new Error(`Missing script: ${scriptName}`)

  const m = script.trim().match(/^node\s+(.+)$/)
  const file = m ? m[1].trim() : null
  if (!file) throw new Error(`Script "${scriptName}" must be "node <file>"`)

  const filePath = file.startsWith('./') ? `${pkgPath}/${file.slice(2)}` : `${pkgPath}/${file}`
  return spawnSyncAsync(filePath, [], { cwd: pkgPath })
}
