import { describe, it, expect } from 'vitest'
import { unsharpMask, boxBlur } from './convolve'

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
})
