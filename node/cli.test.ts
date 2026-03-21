import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryVfs } from './vfs/test-memory'
import { runNode, createNodeSpawner } from './cli'

describe('runNode', () => {
  let vfs: ReturnType<typeof createMemoryVfs>
  let stdout: string
  let stderr: string

  beforeEach(() => {
    vfs = createMemoryVfs()
    stdout = ''
    stderr = ''
  })

  const terminal = () => ({
    write: (t: string) => {
      stdout += t
    },
    writeError: (t: string) => {
      stderr += t
    },
  })

  it('returns 1 for empty args', async () => {
    const code = await runNode([], vfs, terminal())
    expect(code).toBe(1)
    expect(stderr).toContain('usage')
  })

  it('prints version for -v', async () => {
    const code = await runNode(['-v'], vfs, terminal())
    expect(code).toBe(0)
    expect(stdout).toContain('v20')
  })

  it('runs simple JS file', async () => {
    await vfs.mkdir('/project', { recursive: true })
    await vfs.writeFile('/project/hello.js', 'console.log("hello")')

    const code = await runNode(['/project/hello.js'], vfs, terminal(), { cwd: '/' })
    expect(code).toBe(0)
    expect(stdout).toContain('hello')
  })

  it('runs -e eval', async () => {
    const code = await runNode(['-e', 'console.log(1+2)'], vfs, terminal(), { cwd: '/' })
    expect(code).toBe(0)
    expect(stdout).toContain('3')
  })

  it('returns 1 for missing file', async () => {
    const code = await runNode(['/nonexistent.js'], vfs, terminal(), { cwd: '/' })
    expect(code).toBe(1)
    expect(stderr).toContain('No such file')
  })
})

describe('createNodeSpawner', () => {
  it('returns a function matching spawnNode signature', async () => {
    const vfs = createMemoryVfs()
    await vfs.mkdir('/project', { recursive: true })
    await vfs.writeFile('/project/x.js', 'console.log("ok")')

    const spawnNode = createNodeSpawner(vfs, () => {})
    const code = await spawnNode(['/project/x.js'], { cwd: '/' })
    expect(code).toBe(0)
  })
})
