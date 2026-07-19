import { describe, it, expect } from 'vitest'
import { computeAutoAdjustments } from './auto-enhance'
import type { ImageLike } from './types'

/** Build a WxH image from a per-pixel callback returning [r,g,b]. */
function makeImg(w: number, h: number, fn: (x: number, y: number) => [number, number, number]): ImageLike {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y)
      const i = (y * w + x) * 4
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255
    }
  }
  return { data, width: w, height: h }
}

describe('computeAutoAdjustments', () => {
  it('returns values within slider range (-100..100)', () => {
    const img = makeImg(16, 16, (x) => { const v = 100 + (x % 50); return [v, v, v] })
    const adj = computeAutoAdjustments(img)
    for (const v of Object.values(adj)) {
      expect(v).toBeGreaterThanOrEqual(-100)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('boosts contrast on a low-contrast image', () => {
    // All pixels in a narrow 100..150 band → wants more contrast.
    const img = makeImg(16, 16, (x) => { const v = 100 + (x % 50); return [v, v, v] })
    const adj = computeAutoAdjustments(img)
    expect((adj.contrast ?? 0)).toBeGreaterThan(0)
  })

  it('corrects a blue colour cast with positive warmth', () => {
    // Strong blue cast: low red, high blue → gray-world should warm it up.
    const img = makeImg(16, 16, () => [80, 110, 200])
    const adj = computeAutoAdjustments(img)
    expect((adj.warmth ?? 0)).toBeGreaterThan(0)
  })
})
