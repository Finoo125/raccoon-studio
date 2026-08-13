import { describe, it, expect } from 'vitest'
import { orientedSize, cropToPixels, normalizeCrop, resizeCrop, sliceVeil, VEIL_SPAN } from './geometry'
import { applySliceMask } from './pipeline'
import type { Slice } from './types'

describe('geometry', () => {
  it('rotate 90 swaps width/height', () => {
    expect(orientedSize(100, 60, 90)).toEqual({ width: 60, height: 100 })
    expect(orientedSize(100, 60, 0)).toEqual({ width: 100, height: 60 })
  })
  it('crop normalization round-trips', () => {
    const crop = { x: 0.25, y: 0.5, w: 0.5, h: 0.25 }
    const px = cropToPixels(crop, 200, 100)
    expect(px).toEqual({ x: 50, y: 50, w: 100, h: 25 })
    expect(normalizeCrop(px, 200, 100)).toEqual(crop)
  })
})

describe('resizeCrop', () => {
  const full = { x: 0, y: 0, w: 1, h: 1 }
  const half = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }
  const round = (c: { x: number; y: number; w: number; h: number }) =>
    Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.round(v * 1e4) / 1e4]))

  it('drags a corner and leaves the opposite one anchored', () => {
    expect(resizeCrop(full, 'se', -0.3, -0.2, null, 100, 100))
      .toEqual({ x: 0, y: 0, w: 0.7, h: 0.8 })
    expect(resizeCrop(full, 'nw', 0.3, 0.2, null, 100, 100))
      .toEqual({ x: 0.3, y: 0.2, w: 0.7, h: 0.8 })
  })

  it('edge grips move one axis only', () => {
    expect(resizeCrop(half, 'e', 0.1, 0.5, null, 100, 100)).toEqual({ ...half, w: 0.6 })
    expect(resizeCrop(half, 'n', 0.5, -0.1, null, 100, 100))
      .toEqual({ ...half, y: 0.15, h: 0.6 })
  })

  it('move stays inside the frame', () => {
    expect(resizeCrop(half, 'move', 5, 5, null, 100, 100)).toEqual({ ...half, x: 0.5, y: 0.5 })
    expect(resizeCrop(half, 'move', -5, -5, null, 100, 100)).toEqual({ ...half, x: 0, y: 0 })
  })

  it('never shrinks past the minimum', () => {
    const tiny = resizeCrop(full, 'se', -0.99, -0.99, null, 100, 100)
    expect(tiny.w).toBeCloseTo(0.03)
    expect(tiny.h).toBeCloseTo(0.03)
  })

  // The trap: crop is normalised, so a locked 1:1 on a portrait image is NOT w === h.
  it('a locked ratio is applied in pixel space, not normalised space', () => {
    const square = resizeCrop(full, 'se', -0.5, 0, 1, 832, 1216)
    expect(round(square).w).toBe(0.5)
    expect(round(square).h).toBe(0.3421)          // 0.5 * 832 / 1216
    expect(square.w * 832).toBeCloseTo(square.h * 1216)   // actually square in pixels
  })

  it('a locked ratio anchors the south edge when dragging north', () => {
    const from = { x: 0, y: 0.5, w: 0.5, h: 0.5 }
    const out = resizeCrop(from, 'nw', 0, -0.2, 1, 1000, 1000)
    expect(out.h).toBeCloseTo(out.w)
    expect(out.y + out.h).toBeCloseTo(from.y + from.h)   // bottom edge stayed put
  })
})

describe('sliceVeil', () => {
  /** True when applySliceMask actually throws away the pixel at (nx, ny). */
  function isDiscarded(slice: Slice, nx: number, ny: number): boolean {
    const size = 64
    const img = { data: new Uint8ClampedArray(size * size * 4).fill(255), width: size, height: size }
    applySliceMask(img, slice)
    const x = Math.min(size - 1, Math.floor(nx * size))
    const y = Math.min(size - 1, Math.floor(ny * size))
    return img.data[(y * size + x) * 4 + 3] === 0
  }

  const horizontal = (keep: 'a' | 'b'): Slice => ({ ax: 0, ay: 0.5, bx: 1, by: 0.5, keep })
  const diagonal = (keep: 'a' | 'b'): Slice => ({ ax: 0.1, ay: 0.2, bx: 0.9, by: 0.8, keep })

  it('lays the veil along the cut', () => {
    expect(sliceVeil(horizontal('a'))!.angle).toBeCloseTo(0)
    expect(sliceVeil({ ax: 0.5, ay: 0, bx: 0.5, by: 1, keep: 'a' })!.angle).toBeCloseTo(90)
  })

  it('covers the half that keep: a throws away, not the half it keeps', () => {
    // Local +y is the kept side for 'a', so the veil starts a span above the cut.
    expect(sliceVeil(horizontal('a'))!.y).toBe(-VEIL_SPAN)
    expect(sliceVeil(horizontal('b'))!.y).toBe(0)
  })

  it('puts the tag on the half that is actually removed', () => {
    // The real test: whatever the line's direction, the tag must sit on a pixel
    // applySliceMask deletes — otherwise the overlay labels the wrong half.
    for (const slice of [horizontal('a'), horizontal('b'), diagonal('a'), diagonal('b')]) {
      const { label } = sliceVeil(slice)!
      expect(isDiscarded(slice, label.x, label.y)).toBe(true)
    }
  })

  it('keeps the tag inside the frame', () => {
    const { label } = sliceVeil({ ax: 0, ay: 0.02, bx: 1, by: 0.02, keep: 'b' })!
    expect(label.x).toBeGreaterThanOrEqual(0.08)
    expect(label.y).toBeGreaterThanOrEqual(0.08)
    expect(label.y).toBeLessThanOrEqual(0.92)
  })

  it('has nothing to draw for a zero-length cut', () => {
    expect(sliceVeil({ ax: 0.5, ay: 0.5, bx: 0.5, by: 0.5, keep: 'a' })).toBeNull()
  })
})
