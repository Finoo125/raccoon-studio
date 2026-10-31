import { describe, expect, it } from 'vitest'
import { clampTier } from './tiers'

describe('clampTier', () => {
  it('raises a tier below the floor', () => expect(clampTier('s', 'm')).toBe('m'))
  it('keeps tiers at or above it', () => {
    expect(clampTier('m', 'm')).toBe('m')
    expect(clampTier('l', 'm')).toBe('l')
  })
})
