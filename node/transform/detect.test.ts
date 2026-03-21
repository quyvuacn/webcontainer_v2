import { describe, it, expect } from 'vitest'
import { detectFormat, detectLoader } from './detect'

describe('detectFormat', () => {
  it('returns esm for .mjs extension', () => {
    expect(detectFormat('', '/foo.mjs')).toBe('esm')
  })

  it('returns cjs for .cjs extension', () => {
    expect(detectFormat('', '/foo.cjs')).toBe('cjs')
  })

  it('returns esm when package has type: module', () => {
    expect(detectFormat('', '/foo.js', { type: 'module' })).toBe('esm')
  })

  it('returns cjs when package has type: commonjs', () => {
    expect(detectFormat('', '/foo.js', { type: 'commonjs' })).toBe('cjs')
  })

  it('returns esm when code has import statement', () => {
    expect(detectFormat("import x from 'y'", '/foo.js')).toBe('esm')
  })

  it('returns esm when code has export statement', () => {
    expect(detectFormat('export const x = 1', '/foo.js')).toBe('esm')
  })

  it('returns cjs when code has require()', () => {
    expect(detectFormat("const x = require('y')", '/foo.js')).toBe('cjs')
  })

  it('returns cjs when code has module.exports', () => {
    expect(detectFormat('module.exports = {}', '/foo.js')).toBe('cjs')
  })

  it('returns cjs by default for .js', () => {
    expect(detectFormat('const x = 1', '/foo.js')).toBe('cjs')
  })

  it('returns json for .json', () => {
    expect(detectFormat('{}', '/foo.json')).toBe('json')
  })
})

describe('detectLoader', () => {
  it('returns ts for .ts', () => expect(detectLoader('/a.ts')).toBe('ts'))
  it('returns tsx for .tsx', () => expect(detectLoader('/a.tsx')).toBe('tsx'))
  it('returns jsx for .jsx', () => expect(detectLoader('/a.jsx')).toBe('jsx'))
  it('returns json for .json', () => expect(detectLoader('/a.json')).toBe('json'))
  it('returns css for .css', () => expect(detectLoader('/a.css')).toBe('css'))
  it('returns js for .js', () => expect(detectLoader('/a.js')).toBe('js'))
})
