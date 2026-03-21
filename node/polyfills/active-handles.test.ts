import { describe, it, expect, beforeEach } from 'vitest'
import { addActiveHandle } from './active-handles'

describe('addActiveHandle', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__wcActiveHandleCount
  })

  it('tăng count khi add, giảm khi release', () => {
    const release = addActiveHandle()
    expect((globalThis as Record<string, unknown>).__wcActiveHandleCount).toBe(1)
    release()
    expect((globalThis as Record<string, unknown>).__wcActiveHandleCount).toBe(0)
  })

  it('nhiều handle cộng dồn đúng', () => {
    const r1 = addActiveHandle()
    const r2 = addActiveHandle()
    const r3 = addActiveHandle()
    expect((globalThis as Record<string, unknown>).__wcActiveHandleCount).toBe(3)
    r2()
    expect((globalThis as Record<string, unknown>).__wcActiveHandleCount).toBe(2)
    r1()
    r3()
    expect((globalThis as Record<string, unknown>).__wcActiveHandleCount).toBe(0)
  })

  it('release nhiều lần không làm count âm', () => {
    const release = addActiveHandle()
    release()
    release()
    release()
    expect((globalThis as Record<string, unknown>).__wcActiveHandleCount).toBe(0)
  })

  it('bắt đầu từ undefined thì thành 1', () => {
    addActiveHandle()
    expect((globalThis as Record<string, unknown>).__wcActiveHandleCount).toBe(1)
  })
})
