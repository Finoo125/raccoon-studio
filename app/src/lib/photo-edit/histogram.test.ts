import { describe, it, expect } from 'vitest'
import { computeHistogram } from './histogram'
import type { ImageLike } from './types'

const from = (pixels: [number, number, number][]): ImageLike => ({
  data: new Uint8ClampedArray(pixels.flatMap(([r, g, b]) => [r, g, b, 255])),
  width: pixels.length,
  height: 1,
})

describe('computeHistogram', () => {
  it('bins each channel independently', () => {
    const h = computeHistogram(from([[10, 20, 30], [10, 20, 30], [200, 0, 0]]))
    expect(h.r[10]).toBe(2)
    expect(h.g[20]).toBe(2)
    expect(h.b[30]).toBe(2)
    expect(h.r[200]).toBe(1)
  })

  it('reports the clipped fraction at each end', () => {
    const h = computeHistogram(from([[0, 0, 0], [255, 255, 255], [128, 128, 128], [128, 128, 128]]))
    expect(h.clippedLow).toBe(0.25)
    expect(h.clippedHigh).toBe(0.25)
  })

  // A big flat black background otherwise dwarfs every other bin and squashes the
  // rest of the plot flat, so the ends are excluded from the scale.
  it('peak ignores the 0 and 255 bins', () => {
    const pixels: [number, number, number][] = []
    for (let i = 0; i < 100; i++) pixels.push([0, 0, 0])
    for (let i = 0; i < 5; i++) pixels.push([128, 128, 128])
    expect(computeHistogram(from(pixels)).peak).toBe(5)
  })

  it('never returns a zero peak to divide by', () => {
    expect(computeHistogram(from([[0, 0, 0]])).peak).toBe(1)
    expect(computeHistogram({ data: new Uint8ClampedArray(0), width: 0, height: 0 }).peak).toBe(1)
  })
})
