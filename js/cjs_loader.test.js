import { describe, it, expect, vi } from 'vitest'
import { hasRequire, createRequire } from './cjs_loader.js'

describe('cjs_loader', () => {
  it('hasRequire', () => {
    expect(hasRequire('require("x")')).toBe(true)
    expect(hasRequire('module.exports = x')).toBe(true)
    expect(hasRequire('exports.foo = 1')).toBe(true)
    expect(hasRequire('console.log(1)')).toBe(false)
  })

  it('createRequire load module', async () => {
    const vfsRead = vi.fn((path) => {
      if (path === 'project/node_modules/foo/package.json') {
        return Promise.resolve(new TextEncoder().encode(JSON.stringify({ main: 'index.js' })))
      }
      if (path === 'project/node_modules/foo/index.js') {
        return Promise.resolve(new TextEncoder().encode('module.exports = { n: 42 }'))
      }
      return Promise.resolve(null)
    })
    const req = createRequire(vfsRead, 'project')
    const mod = await req('foo')
    expect(mod).toEqual({ n: 42 })
  })

  it('createRequire relative path', async () => {
    const vfsRead = vi.fn((path) => {
      if (path === 'project/node_modules/bar/package.json') {
        return Promise.resolve(new TextEncoder().encode(JSON.stringify({ main: 'main.js' })))
      }
      if (path === 'project/node_modules/bar/main.js') {
        return Promise.resolve(new TextEncoder().encode(`
          const util = require('./util.js');
          module.exports = { sum: util.a + util.b };
        `))
      }
      if (path === 'project/node_modules/bar/util.js') {
        return Promise.resolve(new TextEncoder().encode('module.exports = { a: 1, b: 2 }'))
      }
      return Promise.resolve(null)
    })
    const req = createRequire(vfsRead, 'project')
    const mod = await req('bar')
    expect(mod).toEqual({ sum: 3 })
  })
})
