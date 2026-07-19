import { describe, it, expect } from 'vitest'
import { orientedSize, cropToPixels, normalizeCrop } from './geometry'

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
