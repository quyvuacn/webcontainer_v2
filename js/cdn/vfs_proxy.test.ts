import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./resolver', () => ({
  fetchFromCdn: vi.fn()
}))

import { createCdnVfsProxy } from './vfs_proxy'
import { fetchFromCdn } from './resolver'

describe('createCdnVfsProxy', () => {
  let vfsRead: ReturnType<typeof vi.fn>
  let vfsWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vfsRead = vi.fn()
    vfsWrite = vi.fn()
    vi.mocked(fetchFromCdn).mockResolvedValue(new TextEncoder().encode('module content'))
  })

  it('return from vfsRead when cached', async () => {
    const cached = new Uint8Array([1, 2, 3])
    vfsRead.mockReturnValue(cached)
    const proxy = createCdnVfsProxy(vfsRead, vfsWrite)
    const result = await proxy.read('project/node_modules/pkg/file.js')
    expect(result).toBe(cached)
    expect(fetchFromCdn).not.toHaveBeenCalled()
  })

  it('fetch from CDN when no cache, package.json exists', async () => {
    vfsRead.mockImplementation((path: string) => {
      if (path === 'project/node_modules/pkg/package.json') return new TextEncoder().encode(JSON.stringify({ version: '1.0.0' }))
      return null
    })
    const proxy = createCdnVfsProxy(vfsRead, vfsWrite)
    const result = await proxy.read('project/node_modules/pkg/index.js')
    expect(result).toBeInstanceOf(Uint8Array)
    expect(fetchFromCdn).toHaveBeenCalledWith('pkg', '1.0.0', 'index.js')
    expect(vfsWrite).toHaveBeenCalledWith('project/node_modules/pkg/index.js', expect.any(Uint8Array))
  })

  it('use version from package.json stub', async () => {
    vfsRead.mockImplementation((path: string) => {
      if (path === 'project/node_modules/lodash/package.json') return new TextEncoder().encode(JSON.stringify({ name: 'lodash', version: '4.17.21' }))
      return null
    })
    const proxy = createCdnVfsProxy(vfsRead, vfsWrite)
    await proxy.read('project/node_modules/lodash/lodash.js')
    expect(fetchFromCdn).toHaveBeenCalledWith('lodash', '4.17.21', 'lodash.js')
  })

  it('return null for path not matching node_modules', async () => {
    vfsRead.mockReturnValue(null)
    const proxy = createCdnVfsProxy(vfsRead, vfsWrite)
    const result = await proxy.read('project/src/main.js')
    expect(result).toBeNull()
  })
})
