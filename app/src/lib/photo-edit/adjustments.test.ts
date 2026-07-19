import { describe, it, expect } from 'vitest'
import { applyAdjustments } from './adjustments'
import { ZERO_ADJUSTMENTS } from './types'

const px = (r: number, g: number, b: number) =>
  ({ data: new Uint8ClampedArray([r, g, b, 255]), width: 1, height: 1 })

describe('applyAdjustments', () => {
  it('zero adjustments is identity', () => {
    const img = px(100, 150, 200)
    applyAdjustments(img, { ...ZERO_ADJUSTMENTS })
    expect([...img.data]).toEqual([100, 150, 200, 255])
  })
  it('brightness raises all channels', () => {
    const img = px(100, 100, 100)
    applyAdjustments(img, { ...ZERO_ADJUSTMENTS, brightness: 50 })
    expect(img.data[0]).toBeGreaterThan(100)
  })
  it('saturation -100 produces grayscale (r==g==b)', () => {
    const img = px(200, 100, 50)
    applyAdjustments(img, { ...ZERO_ADJUSTMENTS, saturation: -100 })
    expect(img.data[0]).toBe(img.data[1])
    expect(img.data[1]).toBe(img.data[2])
  })
  it('warmth raises red and lowers blue', () => {
    const img = px(120, 120, 120)
    applyAdjustments(img, { ...ZERO_ADJUSTMENTS, warmth: 100 })
    expect(img.data[0]).toBeGreaterThan(120)
    expect(img.data[2]).toBeLessThan(120)
  })
  it('vignette darkens a corner more than the center', () => {
    const img = { data: new Uint8ClampedArray(9 * 4).fill(200), width: 3, height: 3 }
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255 // alpha
    applyAdjustments(img, { ...ZERO_ADJUSTMENTS, vignette: 100 })
    const center = img.data[(1 * 3 + 1) * 4]      // (1,1)
    const corner = img.data[0]                    // (0,0)
    expect(corner).toBeLessThan(center)
  })
})
