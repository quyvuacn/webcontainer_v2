import { describe, it, expect } from 'vitest'
import { RamVfs } from './vfs_ram.js'

describe('RamVfs', () => {
  it('write + read', () => {
    const vfs = new RamVfs(null)
    vfs.write('a/b.txt', 'hello')
    expect(new TextDecoder().decode(vfs.read('a/b.txt'))).toBe('hello')
  })
  it('readText', () => {
    const vfs = new RamVfs(null)
    vfs.write('x', 'world')
    expect(vfs.readText('x')).toBe('world')
  })
  it('exists', () => {
    const vfs = new RamVfs(null)
    vfs.write('dir/file', 'x')
    expect(vfs.exists('dir/file')).toBe(true)
    expect(vfs.exists('dir')).toBe(true)
    expect(vfs.exists('missing')).toBe(false)
  })
  it('preload không emit', () => {
    const vfs = new RamVfs(null)
    const events = []
    vfs.watch('project', true, ev => events.push(ev))
    vfs.preload('project/x', 'data')
    expect(events).toHaveLength(0)
    expect(vfs.readText('project/x')).toBe('data')
  })
  it('write emit watcher', () => {
    const vfs = new RamVfs(null)
    const events = []
    vfs.watch('project', true, ev => events.push(ev))
    vfs.write('project/a.js', 'x')
    expect(events).toHaveLength(1)
    expect(events[0].path).toBe('project/a.js')
    expect(events[0].kind).toBe('Modified')
  })
  it('write lock buffer events', () => {
    const vfs = new RamVfs(null)
    const events = []
    vfs.watch('project', true, ev => events.push(ev))
    const id = vfs.acquireLock('project/node_modules')
    vfs.write('project/node_modules/a/package.json', '{}')
    expect(events).toHaveLength(0)
    vfs.releaseLock(id)
    expect(events).toHaveLength(1)
  })
  it('pathMatches recursive', () => {
    const vfs = new RamVfs(null)
    expect(vfs.pathMatches('project', 'project/x', true)).toBe(true)
    expect(vfs.pathMatches('project', 'project', true)).toBe(true)
    expect(vfs.pathMatches('project', 'project-backup', true)).toBe(false)
  })
  it('pathMatches non-recursive', () => {
    const vfs = new RamVfs(null)
    expect(vfs.pathMatches('project', 'project/file', false)).toBe(true)
    expect(vfs.pathMatches('project', 'project', false)).toBe(true)
    expect(vfs.pathMatches('project', 'other/file', false)).toBe(false)
  })
})
