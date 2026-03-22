import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { npmInstall } from './install'

describe('npmInstall', () => {
  let vfsRead: ReturnType<typeof vi.fn>
  let vfsWrite: ReturnType<typeof vi.fn>
  let vfsAcquireLock: ReturnType<typeof vi.fn>
  let vfsReleaseLock: ReturnType<typeof vi.fn>
  let mockResolveAll: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const fakePkg = (name: string, version: string) => ({
        name, version, main: 'index.js',
        exports: { '.': { require: './index.js' } }
      })
      if (url.includes('/foo@')) return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(fakePkg('foo', '2.0.0'))).buffer) })
      if (url.includes('/bar@')) return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(fakePkg('bar', '1.0.0'))).buffer) })
      if (url.includes('/x@')) return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(fakePkg('x', '1.0.0'))).buffer) })
      return Promise.resolve({ ok: false })
    }))
    mockResolveAll = vi.fn().mockResolvedValue({
      packages: {
        'node_modules/foo': { version: '2.0.0' },
        'node_modules/bar': { version: '1.0.0' }
      },
      lockfileVersion: 3
    })
    vfsRead = vi.fn((path: string) => {
      if (path === 'project/package.json') {
        return new TextEncoder().encode(JSON.stringify({ dependencies: { foo: '^2' } }))
      }
      return null
    })
    vfsWrite = vi.fn()
    vfsAcquireLock = vi.fn(() => 1)
    vfsReleaseLock = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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
    vfsRead.mockImplementation((path: string) => {
      if (path === 'custom/package.json') return new TextEncoder().encode(JSON.stringify({ dependencies: { x: '1' } }))
      return null
    })
    await npmInstall(vfsRead, vfsWrite, vfsAcquireLock, vfsReleaseLock, 'custom', mockResolveAll, { prefetch: false })
    expect(vfsAcquireLock).toHaveBeenCalledWith('custom/node_modules')
  })
})
