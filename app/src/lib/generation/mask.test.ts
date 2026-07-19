import { describe, it, expect } from 'vitest'
import { maskPixels, hasPaintedPixels } from './mask'

/** Builds an RGBA buffer for `count` pixels, each set to the given tuple. */
function pixels(...px: [number, number, number, number][]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px.length * 4)
  px.forEach((p, i) => out.set(p, i * 4))
  return out
}

describe('maskPixels', () => {
  it('maps any painted (alpha>0) pixel to opaque white and the rest to opaque black', () => {
    // Brush strokes are drawn in some translucent colour; only the alpha matters.
    const src = pixels(
      [120, 30, 200, 180], // painted (semi-transparent purple)
      [0, 0, 0, 0], // untouched
      [255, 255, 255, 4], // faint paint
    )
    const out = maskPixels(src)
    expect(Array.from(out)).toEqual([
      255, 255, 255, 255, // → white
      0, 0, 0, 255, // → black
      255, 255, 255, 255, // → white
    ])
  })

  it('honours a custom alpha threshold so near-transparent smudges stay black', () => {
    const src = pixels(
      [10, 10, 10, 30], // below threshold
      [10, 10, 10, 200], // above threshold
    )
    const out = maskPixels(src, { threshold: 128 })
    expect(Array.from(out)).toEqual([0, 0, 0, 255, 255, 255, 255, 255])
  })

  it('inverts which region is white when invert is set (paint the keep-area instead)', () => {
    const src = pixels(
      [0, 0, 0, 255], // painted
      [0, 0, 0, 0], // untouched
    )
    const out = maskPixels(src, { invert: true })
    expect(Array.from(out)).toEqual([0, 0, 0, 255, 255, 255, 255, 255])
  })

  it('does not mutate the source buffer', () => {
    const src = pixels([1, 2, 3, 255])
    const copy = Uint8ClampedArray.from(src)
    maskPixels(src)
    expect(Array.from(src)).toEqual(Array.from(copy))
  })
})

describe('hasPaintedPixels', () => {
  it('is false for a fully transparent buffer (nothing to inpaint)', () => {
    expect(hasPaintedPixels(pixels([0, 0, 0, 0], [9, 9, 9, 0]))).toBe(false)
  })

  it('is true once any pixel is painted above the threshold', () => {
    expect(hasPaintedPixels(pixels([0, 0, 0, 0], [9, 9, 9, 200]))).toBe(true)
  })

  it('respects the threshold', () => {
    expect(hasPaintedPixels(pixels([0, 0, 0, 30]), 128)).toBe(false)
  })
})
