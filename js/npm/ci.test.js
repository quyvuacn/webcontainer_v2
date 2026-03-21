import { describe, it, expect, vi } from 'vitest'
import { npmCi } from './ci.js'

describe('npmCi', () => {
  it('throw khi không có lockfile', async () => {
    const vfsRead = vi.fn(() => null)
    await expect(npmCi(vfsRead, vi.fn(), vi.fn(), vi.fn())).rejects.toThrow('Missing package-lock.json')
  })

  it('throw khi không có package.json', async () => {
    const vfsRead = vi.fn((path) => {
      if (path === 'project/package-lock.json') return new TextEncoder().encode('{"packages":{}}')
      return null
    })
    await expect(npmCi(vfsRead, vi.fn(), vi.fn(), vi.fn())).rejects.toThrow('No package.json')
  })

  it('install stubs từ lockfile', async () => {
    const written = {}
    const vfsRead = vi.fn((path) => {
      if (path === 'project/package.json') return new TextEncoder().encode(JSON.stringify({ dependencies: { pkg: '^1.0.0' } }))
      if (path === 'project/package-lock.json') return new TextEncoder().encode(JSON.stringify({ packages: { 'node_modules/pkg': { version: '1.0.0' } } }))
      return null
    })
    const vfsWrite = vi.fn((path, b) => { written[path] = b })
    const vfsAcquireLock = vi.fn(() => 1)
    const vfsReleaseLock = vi.fn()

    const r = await npmCi(vfsRead, vfsWrite, vfsAcquireLock, vfsReleaseLock, 'project', { prefetch: false })

    expect(r.added).toBe(1)
    expect(vfsWrite).toHaveBeenCalledWith('project/node_modules/pkg/package.json', expect.anything())
  })
})
