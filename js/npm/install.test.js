import { describe, it, expect, vi, beforeEach } from 'vitest'
import { npmInstall } from './install.js'

describe('npmInstall', () => {
  let vfsRead, vfsWrite, vfsAcquireLock, vfsReleaseLock
  let mockResolveAll

  beforeEach(() => {
    mockResolveAll = vi.fn().mockResolvedValue({
      packages: {
        'node_modules/foo': { version: '2.0.0' },
        'node_modules/bar': { version: '1.0.0' }
      },
      lockfileVersion: 3
    })
    vfsRead = vi.fn((path) => {
      if (path === 'project/package.json') {
        return new TextEncoder().encode(JSON.stringify({ dependencies: { foo: '^2' } }))
      }
      return null
    })
    vfsWrite = vi.fn()
    vfsAcquireLock = vi.fn(() => 1)
    vfsReleaseLock = vi.fn()
  })

  it('throws when no package.json', async () => {
    vfsRead.mockReturnValue(null)
    await expect(npmInstall(vfsRead, vfsWrite, vfsAcquireLock, vfsReleaseLock))
      .rejects.toThrow('No package.json')
  })

  it('return added 0 when no deps', async () => {
    vfsRead.mockReturnValue(new TextEncoder().encode(JSON.stringify({})))
    const r = await npmInstall(vfsRead, vfsWrite, vfsAcquireLock, vfsReleaseLock, 'project', vi.fn().mockResolvedValue({ packages: {}, lockfileVersion: 3 }))
    expect(r.added).toBe(0)
  })

  it('gọi acquire_lock, release_lock, write stubs và lockfile', async () => {
    const r = await npmInstall(vfsRead, vfsWrite, vfsAcquireLock, vfsReleaseLock, 'project', mockResolveAll, { prefetch: false })

    expect(r.added).toBe(2)
    expect(mockResolveAll).toHaveBeenCalledWith({ foo: '^2' })
    expect(vfsAcquireLock).toHaveBeenCalledWith('project/node_modules')
    expect(vfsReleaseLock).toHaveBeenCalledWith(1)
    expect(vfsWrite).toHaveBeenCalledWith('project/node_modules/foo/package.json', expect.anything())
    expect(vfsWrite).toHaveBeenCalledWith('project/node_modules/bar/package.json', expect.anything())
    expect(vfsWrite).toHaveBeenCalledWith('project/package-lock.json', expect.anything())
  })

  it('use custom pkgPath', async () => {
    vfsRead.mockImplementation((path) => {
      if (path === 'custom/package.json') return new TextEncoder().encode(JSON.stringify({ dependencies: { x: '1' } }))
      return null
    })
    await npmInstall(vfsRead, vfsWrite, vfsAcquireLock, vfsReleaseLock, 'custom', mockResolveAll, { prefetch: false })
    expect(vfsAcquireLock).toHaveBeenCalledWith('custom/node_modules')
  })
})
