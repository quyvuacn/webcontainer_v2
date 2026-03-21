export function parseCommandChain(line: string) {
  const trimmed = line.trim()
  if (!trimmed) return null
  const parts = splitByChainOperators(trimmed)
  if (!parts.length) return null
  return parts
}

function splitByChainOperators(input: string) {
  const result: { line: string; op: string | null }[] = []
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

export function parseCommand(line: string) {
  const trimmed = line.trim()
  if (!trimmed) return null
  let tokens = tokenize(trimmed)
  tokens = splitRedirectFromTokens(tokens)
  if (!tokens.length) return null
  const [cmd, ...rest] = tokens
  const { args, redirect } = extractRedirects(rest)
  return redirect !== undefined ? { cmd, args, raw: trimmed, redirect } : { cmd, args, raw: trimmed }
}

function splitRedirectFromTokens(tokens: string[]) {
  const out: string[] = []
  for (const t of tokens) {
    if (t === '>' || t === '>>') {
      out.push(t)
      continue
    }
    const mEnd = t.match(/^(.*)(>>?)$/)
    if (mEnd && mEnd[1] !== '') {
      out.push(mEnd[1], mEnd[2])
      continue
    }
    const mStart = t.match(/^(>>?)(.+)$/)
    if (mStart) {
      out.push(mStart[1], mStart[2])
      continue
    }
    const mMid = t.match(/^(.+?)>(.+)$/)
    if (mMid) {
      out.push(mMid[1], '>', mMid[2])
    } else {
      out.push(t)
    }
  }
  return out
}

function extractRedirects(tokens: string[]) {
  const args: string[] = []
  let redirect: { path: string; append: boolean } | undefined
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

function tokenize(input: string) {
  const tokens: string[] = []
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
