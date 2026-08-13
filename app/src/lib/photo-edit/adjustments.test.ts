import { describe, it, expect } from 'vitest'
import { addGrain, applyAdjustments, isIdentityMixer } from './adjustments'
import { toneLuts } from './curve'
import { defaultHslMixer, defaultToneCurve, ZERO_ADJUSTMENTS, type ImageLike } from './types'

const px = (r: number, g: number, b: number) =>
  ({ data: new Uint8ClampedArray([r, g, b, 255]), width: 1, height: 1 })

/** A 1×N strip, handy for asking how an adjustment weights across the tonal range. */
const strip = (...levels: number[]): ImageLike => ({
  data: new Uint8ClampedArray(levels.flatMap((v) => [v, v, v, 255])),
  width: levels.length,
  height: 1,
})

describe('applyAdjustments', () => {
  it('zero adjustments is identity', () => {
    const img = px(100, 150, 200)
    applyAdjustments(img, { ...ZERO_ADJUSTMENTS })
    expect([...img.data]).toEqual([100, 150, 200, 255])
  })
  it('exposure scales multiplicatively — a stop at +100', () => {
    const img = px(100, 100, 100)
    applyAdjustments(img, { ...ZERO_ADJUSTMENTS, exposure: 100 })
    expect(img.data[0]).toBe(200)
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

describe('tone sliders', () => {
  const levels = [16, 64, 128, 192, 240]
  const deltas = (key: 'highlights' | 'shadows' | 'whites' | 'blacks', v: number) => {
    const img = strip(...levels)
    applyAdjustments(img, { ...ZERO_ADJUSTMENTS, [key]: v })
    return levels.map((L, i) => img.data[i * 4] - L)
  }

  it('highlights move the bright end, shadows the dark end', () => {
    const hi = deltas('highlights', 100)
    const lo = deltas('shadows', 100)
    expect(hi[4]).toBeGreaterThan(hi[0])
    expect(lo[0]).toBeGreaterThan(lo[4])
  })

  // The distinction that makes them worth having as separate sliders: whites and
  // blacks weight by luminance *squared*, so they bite at the ends of the range
  // where highlights/shadows are still working on the midtones.
  it('whites and blacks are more end-weighted than highlights and shadows', () => {
    const wh = deltas('whites', 100), hi = deltas('highlights', 100)
    expect(wh[2] / wh[4]).toBeLessThan(hi[2] / hi[4])
    const bl = deltas('blacks', 100), sh = deltas('shadows', 100)
    expect(bl[2] / bl[0]).toBeLessThan(sh[2] / sh[0])
  })

  it('negative values darken', () => {
    expect(deltas('whites', -100)[4]).toBeLessThan(0)
    expect(deltas('blacks', -100)[0]).toBeLessThan(0)
  })
})

describe('tone curve in the point pass', () => {
  it('applies the composed LUT per channel', () => {
    const curve = defaultToneCurve()
    curve.rgb = [{ x: 0, y: 0 }, { x: 128, y: 200 }, { x: 255, y: 255 }]
    const img = px(128, 128, 128)
    applyAdjustments(img, { ...ZERO_ADJUSTMENTS }, toneLuts(curve))
    expect(img.data[0]).toBe(200)
  })

  it('null luts leave the pixel untouched', () => {
    const img = px(70, 80, 90)
    applyAdjustments(img, { ...ZERO_ADJUSTMENTS }, null)
    expect([...img.data]).toEqual([70, 80, 90, 255])
  })
})

describe('HSL colour mixer', () => {
  it('an untouched mixer is detected and skipped', () => {
    expect(isIdentityMixer(defaultHslMixer())).toBe(true)
    const hsl = defaultHslMixer(); hsl.blue.sat = -20
    expect(isIdentityMixer(hsl)).toBe(false)
  })

  it('desaturating a band only touches that band', () => {
    const hsl = defaultHslMixer()
    hsl.red.sat = -100
    const red = px(220, 40, 40), blue = px(40, 40, 220)
    applyAdjustments(red, { ...ZERO_ADJUSTMENTS }, null, hsl)
    applyAdjustments(blue, { ...ZERO_ADJUSTMENTS }, null, hsl)
    expect(red.data[0]).toBeCloseTo(red.data[2], -1)      // red went grey
    expect(blue.data[2] - blue.data[0]).toBeGreaterThan(100) // blue untouched
  })

  it('a luminance lift brightens its band', () => {
    const hsl = defaultHslMixer()
    hsl.green.lum = 80
    const img = px(40, 200, 40)
    applyAdjustments(img, { ...ZERO_ADJUSTMENTS }, null, hsl)
    expect(img.data[1]).toBeGreaterThan(200)
  })

  it('leaves neutral grey alone — it has no hue to shift', () => {
    const hsl = defaultHslMixer()
    for (const band of Object.values(hsl)) { band.hue = 100; band.sat = 100; band.lum = 100 }
    const img = px(128, 128, 128)
    applyAdjustments(img, { ...ZERO_ADJUSTMENTS }, null, hsl)
    expect([...img.data]).toEqual([128, 128, 128, 255])
  })
})

describe('addGrain', () => {
  it('is deterministic — the same pixel gets the same noise every render', () => {
    const a = strip(...new Array(64).fill(128))
    const b = strip(...new Array(64).fill(128))
    addGrain(a, 60); addGrain(b, 60)
    expect([...a.data]).toEqual([...b.data])
  })

  it('varies across pixels and scales with amount', () => {
    const img = strip(...new Array(256).fill(128))
    addGrain(img, 60)
    const values = new Set<number>()
    for (let i = 0; i < img.data.length; i += 4) values.add(img.data[i])
    expect(values.size).toBeGreaterThan(10)

    const spread = (amount: number) => {
      const s = strip(...new Array(256).fill(128))
      addGrain(s, amount)
      let max = 0
      for (let i = 0; i < s.data.length; i += 4) max = Math.max(max, Math.abs(s.data[i] - 128))
      return max
    }
    expect(spread(100)).toBeGreaterThan(spread(20))
    expect(spread(0)).toBe(0)
  })
})
