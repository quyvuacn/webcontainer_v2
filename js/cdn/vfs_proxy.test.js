import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./resolver.js', () => ({
  fetchFromCdn: vi.fn()
}))

import { createCdnVfsProxy } from './vfs_proxy.js'
import { fetchFromCdn } from './resolver.js'

describe('createCdnVfsProxy', () => {
  let vfsRead, vfsWrite

  beforeEach(() => {
    vfsRead = vi.fn()
    vfsWrite = vi.fn()
    vi.mocked(fetchFromCdn).mockResolvedValue(new TextEncoder().encode('module content'))
  })

  it('trả về từ vfsRead khi có cache', async () => {
    const cached = new Uint8Array([1, 2, 3])
    vfsRead.mockReturnValue(cached)
    const proxy = createCdnVfsProxy(vfsRead, vfsWrite)
    const result = await proxy.read('project/node_modules/pkg/file.js')
    expect(result).toBe(cached)
    expect(fetchFromCdn).not.toHaveBeenCalled()
  })

  it('fetch từ CDN khi không có cache, package.json có sẵn', async () => {
    vfsRead.mockImplementation((path) => {
      if (path === 'project/node_modules/pkg/package.json') return new TextEncoder().encode(JSON.stringify({ version: '1.0.0' }))
      return null
    })
    const proxy = createCdnVfsProxy(vfsRead, vfsWrite)
    const result = await proxy.read('project/node_modules/pkg/index.js')
    expect(result).toBeInstanceOf(Uint8Array)
    expect(fetchFromCdn).toHaveBeenCalledWith('pkg', '1.0.0', 'index.js')
    expect(vfsWrite).toHaveBeenCalledWith('project/node_modules/pkg/index.js', expect.any(Uint8Array))
  })

  it('dùng version từ package.json stub', async () => {
    vfsRead.mockImplementation((path) => {
      if (path === 'project/node_modules/lodash/package.json') return new TextEncoder().encode(JSON.stringify({ name: 'lodash', version: '4.17.21' }))
      return null
    })
    const proxy = createCdnVfsProxy(vfsRead, vfsWrite)
    await proxy.read('project/node_modules/lodash/lodash.js')
    expect(fetchFromCdn).toHaveBeenCalledWith('lodash', '4.17.21', 'lodash.js')
  })

  it('return null cho path không match node_modules', async () => {
    vfsRead.mockReturnValue(null)
    const proxy = createCdnVfsProxy(vfsRead, vfsWrite)
    const result = await proxy.read('project/src/main.js')
    expect(result).toBeNull()
  })
})
