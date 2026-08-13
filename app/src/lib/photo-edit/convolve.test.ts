import { describe, it, expect } from 'vitest'
import { unsharpMask, boxBlur, dehaze } from './convolve'
import type { ImageLike } from './types'

const solid = (n: number, val: number) => {
  const d = new Uint8ClampedArray(n * n * 4)
  for (let i = 0; i < d.length; i += 4) { d[i] = d[i+1] = d[i+2] = val; d[i+3] = 255 }
  return { data: d, width: n, height: n }
}

describe('convolve', () => {
  it('unsharpMask is a no-op on a flat image (no local contrast)', () => {
    const img = solid(5, 128)
    unsharpMask(img, 1, 1) // radius, amount
    expect([...img.data].filter((_, k) => k % 4 !== 3).every((v) => v === 128)).toBe(true)
  })
  it('boxBlur preserves a flat image', () => {
    const img = solid(5, 200)
    boxBlur(img, 1)
    expect(img.data[0]).toBe(200)
  })
  // The sliding window is an optimisation, so the thing worth testing is that it
  // still agrees with the obvious implementation — including at the clamped edges,
  // which is exactly where an off-by-one in the window bookkeeping would show up.
  it('matches a naive per-pixel box blur', () => {
    const w = 17, h = 11
    const src = new Uint8ClampedArray(w * h * 4)
    for (let p = 0; p < w * h; p++) {
      src[p * 4] = (p * 53) % 256
      src[p * 4 + 1] = (p * 97) % 256
      src[p * 4 + 2] = (p * 191) % 256
      src[p * 4 + 3] = 255
    }

    const naive = (radius: number) => {
      const span = radius * 2 + 1
      const tmp = new Float32Array(src.length)
      const out = new Uint8ClampedArray(src)
      for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) for (let x = 0; x < w; x++) {
        let sum = 0
        for (let k = -radius; k <= radius; k++) sum += src[(y * w + Math.min(w - 1, Math.max(0, x + k))) * 4 + c]
        tmp[(y * w + x) * 4 + c] = sum / span
      }
      for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) for (let y = 0; y < h; y++) {
        let sum = 0
        for (let k = -radius; k <= radius; k++) sum += tmp[(Math.min(h - 1, Math.max(0, y + k)) * w + x) * 4 + c]
        out[(y * w + x) * 4 + c] = sum / span
      }
      return out
    }

    for (const radius of [1, 2, 6, 9]) {
      const img = { data: new Uint8ClampedArray(src), width: w, height: h }
      boxBlur(img, radius)
      expect([...img.data], `radius ${radius}`).toEqual([...naive(radius)])
    }
  })

  it('a radius wider than the image still clamps cleanly', () => {
    const img = { data: new Uint8ClampedArray([10, 10, 10, 255, 250, 250, 250, 255]), width: 2, height: 1 }
    boxBlur(img, 8)
    // Window is 17 wide over 2 pixels, so edge extension dominates and the two
    // results stay apart: pixel 0 sees 9 copies of itself and 8 of its neighbour.
    expect(img.data[0]).toBe(Math.round((9 * 10 + 8 * 250) / 17))
    expect(img.data[4]).toBe(Math.round((8 * 10 + 9 * 250) / 17))
  })

  it('a negative unsharp amount softens instead of sharpening', () => {
    // Negative clarity/texture: blend toward the blur rather than away from it.
    const edge: ImageLike = {
      data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]),
      width: 3, height: 1,
    }
    unsharpMask(edge, 1, -1)
    expect(edge.data[4]).toBeLessThan(255)   // the bright pixel got pulled down
  })
})

describe('dehaze', () => {
  /** A grey veil laid over a high-contrast checker — the thing dehaze exists to strip. */
  const hazy = (n: number, veil: number): ImageLike => {
    const d = new Uint8ClampedArray(n * n * 4)
    for (let p = 0; p < n * n; p++) {
      const dark = ((p % n) + ((p / n) | 0)) % 2 === 0 ? 20 : 90
      const v = dark * (1 - veil) + 210 * veil
      d[p * 4] = v; d[p * 4 + 1] = v; d[p * 4 + 2] = v; d[p * 4 + 3] = 255
    }
    return { data: d, width: n, height: n }
  }

  const contrast = (img: ImageLike) => {
    let lo = 255, hi = 0
    for (let i = 0; i < img.data.length; i += 4) { lo = Math.min(lo, img.data[i]); hi = Math.max(hi, img.data[i]) }
    return hi - lo
  }

  it('recovers contrast lost to haze', () => {
    const img = hazy(24, 0.6)
    const before = contrast(img)
    dehaze(img, 0.8)
    expect(contrast(img)).toBeGreaterThan(before)
  })

  it('a negative amount adds haze instead', () => {
    const img = hazy(24, 0)
    const before = contrast(img)
    dehaze(img, -0.7)
    expect(contrast(img)).toBeLessThan(before)
  })

  it('zero is a no-op', () => {
    const img = hazy(8, 0.4)
    const copy = [...img.data]
    dehaze(img, 0)
    expect([...img.data]).toEqual(copy)
  })

  it('does not blow up on a flat image (no dark channel to divide by)', () => {
    const img = solid(8, 255)
    dehaze(img, 1)
    expect([...img.data].every((v) => Number.isFinite(v))).toBe(true)
  })
})
