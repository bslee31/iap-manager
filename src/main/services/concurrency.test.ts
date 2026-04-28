import { describe, it, expect } from 'vitest'
import { runWithConcurrency } from './concurrency'

describe('runWithConcurrency', () => {
  it('preserves index alignment between input and result', async () => {
    const items = [10, 20, 30, 40, 50]
    const results = await runWithConcurrency(items, 2, async (n) => n * 2)
    expect(results).toEqual([20, 40, 60, 80, 100])
  })

  it('respects the concurrency limit', async () => {
    let active = 0
    let peak = 0
    const items = Array.from({ length: 10 }, (_, i) => i)

    await runWithConcurrency(items, 3, async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
    })

    expect(peak).toBe(3)
  })

  it('handles an empty input array', async () => {
    let called = 0
    const results = await runWithConcurrency<number, number>([], 5, async (n) => {
      called++
      return n
    })
    expect(results).toEqual([])
    expect(called).toBe(0)
  })

  it('clamps runner count when limit exceeds item count', async () => {
    let active = 0
    let peak = 0
    const items = [1, 2]

    await runWithConcurrency(items, 100, async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 1))
      active--
    })

    // Should not spawn more runners than there are items.
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('passes the index to the worker', async () => {
    const items = ['a', 'b', 'c']
    const indices: number[] = []
    await runWithConcurrency(items, 2, async (_item, idx) => {
      indices.push(idx)
      return idx
    })
    expect(indices.sort()).toEqual([0, 1, 2])
  })

  it('propagates worker rejections', async () => {
    await expect(
      runWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom')
        return n
      })
    ).rejects.toThrow('boom')
  })
})
