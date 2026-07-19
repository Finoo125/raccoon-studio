import { describe, it, expect } from 'vitest'
import { defaultEditState, ZERO_ADJUSTMENTS } from './types'

describe('defaultEditState', () => {
  it('is a neutral, no-op edit', () => {
    const s = defaultEditState()
    expect(Object.values(s.adjustments).every((v) => v === 0)).toBe(true)
    expect(s.filter).toEqual({ id: 'original', intensity: 1 })
    expect(s.crop).toBeNull()
    expect(s.straighten).toBe(0)
    expect(s.rotate).toBe(0)
    expect(s.flipH).toBe(false)
    expect(s.flipV).toBe(false)
  })
  it('returns a fresh adjustments object each call', () => {
    expect(defaultEditState().adjustments).not.toBe(ZERO_ADJUSTMENTS)
  })
})
