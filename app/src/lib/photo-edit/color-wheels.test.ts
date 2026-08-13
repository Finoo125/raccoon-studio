import { describe, it, expect } from 'vitest'
import { applyColorWheels, isNeutralWheels } from './color-wheels'
import { defaultColorWheels, type ImageLike } from './types'

const px = (v: number): ImageLike =>
  ({ data: new Uint8ClampedArray([v, v, v, 255]), width: 1, height: 1 })

describe('applyColorWheels', () => {
  // The reason these wheels don't reuse applyColorGrade: that one blends toward an
  // absolute colour, so a neutral (grey) wheel would wash the image out.
  it('centred wheels are a true no-op', () => {
    const w = defaultColorWheels()
    expect(isNeutralWheels(w)).toBe(true)
    const img = px(160)
    applyColorWheels(img, w)
    expect([...img.data]).toEqual([160, 160, 160, 255])
  })

  it('warms shadows without touching highlights', () => {
    const w = defaultColorWheels()
    w.shadows = { hue: 30, sat: 100, lum: 0 }   // orange
    const dark = px(20), bright = px(245)
    applyColorWheels(dark, w)
    applyColorWheels(bright, w)
    expect(dark.data[0]).toBeGreaterThan(20)          // red up in the shadows
    expect(dark.data[2]).toBeLessThan(20)             // blue down
    expect([...bright.data]).toEqual([245, 245, 245, 255])
  })

  it('cools highlights without touching shadows', () => {
    const w = defaultColorWheels()
    w.highlights = { hue: 220, sat: 100, lum: 0 }
    const dark = px(10), bright = px(250)
    applyColorWheels(dark, w)
    applyColorWheels(bright, w)
    expect(bright.data[2]).toBeGreaterThanOrEqual(bright.data[0])
    expect([...dark.data]).toEqual([10, 10, 10, 255])
  })

  it('midtones bite hardest at mid-grey', () => {
    const w = defaultColorWheels()
    w.midtones = { hue: 120, sat: 100, lum: 0 }
    const mid = px(128), dark = px(4)
    applyColorWheels(mid, w)
    applyColorWheels(dark, w)
    expect(mid.data[1] - mid.data[0]).toBeGreaterThan(20)
    expect(dark.data[1] - dark.data[0]).toBeLessThan(5)
  })

  it('a zone luminance lifts only its own zone', () => {
    const w = defaultColorWheels()
    w.shadows = { hue: 0, sat: 0, lum: 100 }
    const dark = px(10), bright = px(250)
    applyColorWheels(dark, w)
    applyColorWheels(bright, w)
    expect(dark.data[0]).toBeGreaterThan(10)
    expect(bright.data[0]).toBe(250)
  })

  it('blending scales the whole grade, and zero disables it', () => {
    const strong = defaultColorWheels()
    strong.shadows = { hue: 30, sat: 100, lum: 0 }
    const weak = { ...strong, blending: 25 }
    const off = { ...strong, blending: 0 }
    const a = px(30), b = px(30), c = px(30)
    applyColorWheels(a, strong); applyColorWheels(b, weak); applyColorWheels(c, off)
    expect(a.data[0] - 30).toBeGreaterThan(b.data[0] - 30)
    expect([...c.data]).toEqual([30, 30, 30, 255])
  })

  it('balance slides which pixels count as shadows', () => {
    const w = defaultColorWheels()
    w.shadows = { hue: 30, sat: 100, lum: 0 }
    const neutralSplit = px(150), shifted = px(150)
    applyColorWheels(neutralSplit, w)
    applyColorWheels(shifted, { ...w, balance: 100 })
    expect(shifted.data[0]).toBeGreaterThan(neutralSplit.data[0])
  })
})
