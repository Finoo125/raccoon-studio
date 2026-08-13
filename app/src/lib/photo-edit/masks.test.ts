import { describe, it, expect } from 'vitest'
import { buildMask, isNoopMask } from './masks'
import { ZERO_ADJUSTMENTS, type ImageLike, type Mask } from './types'

const base = (over: Partial<Mask>): Mask => ({
  id: 'm', kind: 'linear', name: 'Mask', invert: false, feather: 100,
  adjustments: { ...ZERO_ADJUSTMENTS }, ...over,
})

/** Flat mid-grey unless levels are given, laid out as one row. */
const img = (w: number, h: number, levels?: number[]): ImageLike => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let p = 0; p < w * h; p++) {
    const v = levels ? levels[p] : 128
    data[p * 4] = v; data[p * 4 + 1] = v; data[p * 4 + 2] = v; data[p * 4 + 3] = 255
  }
  return { data, width: w, height: h }
}

describe('linear mask', () => {
  it('ramps from 0 at A to 255 at B', () => {
    const m = base({ linear: { ax: 0, ay: 0.5, bx: 1, by: 0.5 } })
    const a = buildMask(m, img(9, 1))
    expect(a[0]).toBeLessThan(20)
    expect(a[8]).toBeGreaterThan(235)
    expect(a[4]).toBeGreaterThan(100)
    expect(a[4]).toBeLessThan(155)
    for (let i = 1; i < 9; i++) expect(a[i]).toBeGreaterThanOrEqual(a[i - 1])
  })

  it('zero feather makes a hard edge at the midpoint', () => {
    const a = buildMask(base({ linear: { ax: 0, ay: 0.5, bx: 1, by: 0.5 }, feather: 0 }), img(9, 1))
    expect(a[3]).toBe(0)
    expect(a[5]).toBe(255)
  })

  it('a degenerate (zero length) gradient yields an empty mask', () => {
    const a = buildMask(base({ linear: { ax: 0.5, ay: 0.5, bx: 0.5, by: 0.5 } }), img(4, 1))
    expect([...a]).toEqual([0, 0, 0, 0])
  })
})

describe('radial mask', () => {
  it('is opaque at the centre and empty outside the ellipse', () => {
    const m = base({ kind: 'radial', radial: { cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.25 }, feather: 20 })
    const a = buildMask(m, img(21, 21))
    expect(a[10 * 21 + 10]).toBe(255)   // centre
    expect(a[0]).toBe(0)                // corner, well outside
  })

  it('invert swaps inside for outside', () => {
    const m = base({ kind: 'radial', radial: { cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.25 }, feather: 20, invert: true })
    const a = buildMask(m, img(21, 21))
    expect(a[10 * 21 + 10]).toBe(0)
    expect(a[0]).toBe(255)
  })
})

describe('brush mask', () => {
  it('paints a round dab that fades outward', () => {
    const m = base({
      kind: 'brush', feather: 50,
      brush: [{ radius: 0.2, erase: false, points: [{ x: 0.5, y: 0.5 }] }],
    })
    const a = buildMask(m, img(21, 21))
    expect(a[10 * 21 + 10]).toBe(255)
    expect(a[10 * 21 + 14]).toBeLessThan(255)
    expect(a[0]).toBe(0)
  })

  it('an erase stroke takes back what a paint stroke laid down', () => {
    const paint = { radius: 0.3, erase: false, points: [{ x: 0.5, y: 0.5 }] }
    const rub = { radius: 0.3, erase: true, points: [{ x: 0.5, y: 0.5 }] }
    const a = buildMask(base({ kind: 'brush', feather: 0, brush: [paint, rub] }), img(21, 21))
    expect(a[10 * 21 + 10]).toBe(0)
  })

  // The brush is round on screen, so its radius has to be the same pixel count on
  // both axes — scaling it by height on a non-square image would draw an ellipse.
  it('stays circular on a non-square image', () => {
    const m = base({ kind: 'brush', feather: 0, brush: [{ radius: 0.25, erase: false, points: [{ x: 0.5, y: 0.5 }] }] })
    const a = buildMask(m, img(40, 20))
    let right = 0, down = 0
    for (let x = 20; x < 40; x++) if (a[10 * 40 + x] > 127) right++
    for (let y = 10; y < 20; y++) if (a[y * 40 + 20] > 127) down++
    expect(right).toBe(down)
  })
})

describe('luminance mask', () => {
  it('selects only the levels inside the range', () => {
    const m = base({ kind: 'luminance', luminance: { min: 100, max: 160 }, feather: 0 })
    const a = buildMask(m, img(5, 1, [0, 90, 130, 200, 255]))
    expect(a[0]).toBe(0)
    expect(a[2]).toBe(255)
    expect(a[4]).toBe(0)
  })

  it('feather softens both ends of the range', () => {
    const soft = buildMask(base({ kind: 'luminance', luminance: { min: 100, max: 160 }, feather: 100 }), img(1, 1, [96]))
    const hard = buildMask(base({ kind: 'luminance', luminance: { min: 100, max: 160 }, feather: 0 }), img(1, 1, [96]))
    expect(hard[0]).toBe(0)
    expect(soft[0]).toBeGreaterThan(0)
  })
})

describe('isNoopMask', () => {
  it('is true until the mask actually adjusts something', () => {
    expect(isNoopMask(base({}))).toBe(true)
    expect(isNoopMask(base({ adjustments: { ...ZERO_ADJUSTMENTS, exposure: 10 } }))).toBe(false)
  })
})
