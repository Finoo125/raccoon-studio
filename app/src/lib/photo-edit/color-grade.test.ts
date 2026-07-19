import { describe, it, expect } from 'vitest'
import { applyColorGrade } from './color-grade'
import type { ColorGrade } from './types'

const px = (r: number, g: number, b: number) =>
  ({ data: new Uint8ClampedArray([r, g, b, 255]), width: 1, height: 1 })

const TEAL_ORANGE: ColorGrade = { shadow: [0, 128, 128], highlight: [255, 160, 0], balance: 0 }

describe('applyColorGrade', () => {
  it('strength 0 is a no-op', () => {
    const img = px(100, 150, 200)
    applyColorGrade(img, TEAL_ORANGE, 0)
    expect([...img.data]).toEqual([100, 150, 200, 255])
  })

  it('pulls a dark pixel toward the shadow tint', () => {
    const img = px(20, 20, 20) // near-black → biased to shadow color (teal)
    applyColorGrade(img, TEAL_ORANGE, 1)
    expect(img.data[2]).toBeGreaterThan(20) // blue channel rises toward teal
    expect(img.data[0]).toBeLessThanOrEqual(20) // red stays low
  })

  it('pulls a bright pixel toward the highlight tint', () => {
    const img = px(235, 235, 235) // near-white → biased to highlight color (orange)
    applyColorGrade(img, TEAL_ORANGE, 1)
    expect(img.data[0]).toBeGreaterThanOrEqual(235) // red stays high
    expect(img.data[2]).toBeLessThan(235) // blue drops toward orange
  })

  it('leaves alpha untouched', () => {
    const img = { data: new Uint8ClampedArray([100, 100, 100, 123]), width: 1, height: 1 }
    applyColorGrade(img, TEAL_ORANGE, 1)
    expect(img.data[3]).toBe(123)
  })
})
