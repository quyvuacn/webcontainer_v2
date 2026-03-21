import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveAll } from './resolver.js'

describe('resolveAll', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      const m = url.match(/registry\.npmjs\.org\/(.+)$/)
      if (!m) return Promise.reject(new Error('unknown'))
      const name = m[1]
      if (name === 'pkg-a') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            name: 'pkg-a',
            versions: {
              '1.0.0': { dependencies: {} },
              '2.0.0': { dependencies: {} }
            }
          })
        })
      }
      if (name === 'pkg-b') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            name: 'pkg-b',
            versions: { '1.0.0': { dependencies: {} } }
          })
        })
      }
      return Promise.resolve({ ok: false })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolve single dep', async () => {
    const lock = await resolveAll({ 'pkg-a': '^1.0.0' })
    expect(lock.packages['node_modules/pkg-a']).toBeDefined()
    expect(lock.packages['node_modules/pkg-a'].version).toBe('1.0.0')
  })
  it('resolve multiple deps', async () => {
    const lock = await resolveAll({ 'pkg-a': '^1.0.0', 'pkg-b': '1.0.0' })
    expect(lock.packages['node_modules/pkg-a']).toBeDefined()
    expect(lock.packages['node_modules/pkg-b']).toBeDefined()
  })
  it('empty deps', async () => {
    const lock = await resolveAll({})
    expect(Object.keys(lock.packages)).toHaveLength(0)
  })
})
