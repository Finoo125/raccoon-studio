import { describe, it, expect } from 'vitest'
import { formatEta } from './eta'

describe('formatEta', () => {
  it('returns null before any steps have completed', () => {
    expect(formatEta(0, 8, 1000, 5000)).toBeNull()
  })

  it('returns null when there are no steps to run', () => {
    expect(formatEta(0, 0, 1000, 5000)).toBeNull()
  })

  it('returns null when the job has no start time', () => {
    expect(formatEta(4, 8, undefined, 5000)).toBeNull()
  })

  it('estimates a sub-minute remaining time as ~Ns', () => {
    // 4 of 8 steps in 4000ms → 1000ms/step → 4 steps left → 4000ms → ~4s
    expect(formatEta(4, 8, 1000, 5000)).toBe('~4s')
  })

  it('rounds the remaining seconds', () => {
    // 3 of 8 steps in 5000ms → 1666.7ms/step → 5 steps left → 8333ms → ~8s
    expect(formatEta(3, 8, 0, 5000)).toBe('~8s')
  })

  it('formats a minute-plus estimate as ~Mm Ss', () => {
    // 1 of 10 steps in 12000ms → 12000ms/step → 9 steps left → 108000ms → ~1m 48s
    expect(formatEta(1, 10, 0, 12000)).toBe('~1m 48s')
  })
})
