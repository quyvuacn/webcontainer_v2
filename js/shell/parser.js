export function parseCommandChain(line) {
  const trimmed = line.trim()
  if (!trimmed) return null
  const parts = splitByChainOperators(trimmed)
  if (!parts.length) return null
  return parts
}

function splitByChainOperators(input) {
  const result = []
  let current = ''
  let i = 0
  let inSingle = false
  let inDouble = false

  while (i < input.length) {
    const ch = input[i]
    const next = input[i + 1]
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      current += ch
      i++
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      current += ch
      i++
      continue
    }
    if (inSingle || inDouble) {
      current += ch
      i++
      continue
    }
    if (ch === '&' && next === '&') {
      result.push({ line: current.trim(), op: '&&' })
      current = ''
      i += 2
      continue
    }
    if (ch === '|' && next === '|') {
      result.push({ line: current.trim(), op: '||' })
      current = ''
      i += 2
      continue
    }
    if (ch === ';') {
      result.push({ line: current.trim(), op: ';' })
      current = ''
      i++
      continue
    }
    current += ch
    i++
  }
  if (current.trim()) result.push({ line: current.trim(), op: null })
  return result
}

export function parseCommand(line) {
  const trimmed = line.trim()
  if (!trimmed) return null
  const tokens = tokenize(trimmed)
  if (!tokens.length) return null
  const [cmd, ...rest] = tokens
  const { args, redirect } = extractRedirects(rest)
  return redirect !== undefined ? { cmd, args, raw: trimmed, redirect } : { cmd, args, raw: trimmed }
}

function extractRedirects(tokens) {
  const args = []
  let redirect
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '>' && tokens[i + 1]) {
      redirect = { path: tokens[i + 1], append: false }
      i++
    } else if (t === '>>' && tokens[i + 1]) {
      redirect = { path: tokens[i + 1], append: true }
      i++
    } else {
      args.push(t)
    }
  }
  return redirect !== undefined ? { args, redirect } : { args }
}

function tokenize(input) {
  const tokens = []
  let current = ''
  let inSingle = false
  let inDouble = false
  for (const ch of input) {
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) inDouble = !inDouble
    else if (ch === ' ' && !inSingle && !inDouble) {
      if (current) {
        tokens.push(current)
        current = ''
      }
    } else current += ch
  }
  if (current) tokens.push(current)
  return tokens
}
