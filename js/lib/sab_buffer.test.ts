import { describe, it, expect } from 'vitest'
import { createBuffer, readBuffer, writeToBuffer } from './sab_buffer'

describe('sab_buffer', () => {
  it('createBuffer + writeToBuffer + readBuffer', () => {
    const buf = createBuffer(1024)
    writeToBuffer(buf, 'hello')
    expect(readBuffer(buf)).toBe('hello')
  })
  it('append nhiều lần', () => {
    const buf = createBuffer(1024)
    writeToBuffer(buf, 'a')
    writeToBuffer(buf, 'b')
    writeToBuffer(buf, 'c')
    expect(readBuffer(buf)).toBe('abc')
  })
  it('readBuffer only reads, does not mutate buffer', () => {
    const buf = createBuffer(1024)
    writeToBuffer(buf, 'x')
    expect(readBuffer(buf)).toBe('x')
    writeToBuffer(buf, 'y')
    expect(readBuffer(buf)).toBe('xy')
  })
  it('writeToBuffer with Uint8Array', () => {
    const buf = createBuffer(1024)
    writeToBuffer(buf, new Uint8Array([65, 66, 67]))
    expect(readBuffer(buf)).toBe('ABC')
  })
})
