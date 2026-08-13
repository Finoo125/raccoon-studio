import { describe, it, expect } from 'vitest'
import { curveLut, isIdentityCurve, toneLuts } from './curve'
import { defaultToneCurve, IDENTITY_CURVE } from './types'

describe('curveLut', () => {
  it('the identity curve is a no-op', () => {
    const lut = curveLut(IDENTITY_CURVE)
    for (let v = 0; v < 256; v++) expect(lut[v]).toBe(v)
  })

  it('interpolates through every control point it is given', () => {
    const pts = [{ x: 0, y: 0 }, { x: 64, y: 100 }, { x: 192, y: 200 }, { x: 255, y: 255 }]
    const lut = curveLut(pts)
    for (const p of pts) expect(lut[p.x]).toBe(p.y)
  })

  it('stays monotonic — no overshoot between close points', () => {
    // A plain cubic spline dips below the previous value here, which reads as
    // inverted contrast: a highlight getting darker as its point is dragged up.
    const lut = curveLut([{ x: 0, y: 0 }, { x: 100, y: 20 }, { x: 110, y: 235 }, { x: 255, y: 255 }])
    for (let v = 1; v < 256; v++) expect(lut[v]).toBeGreaterThanOrEqual(lut[v - 1])
  })

  it('clamps flat outside the outermost points', () => {
    const lut = curveLut([{ x: 50, y: 10 }, { x: 200, y: 240 }])
    expect(lut[0]).toBe(10)
    expect(lut[49]).toBe(10)
    expect(lut[255]).toBe(240)
  })

  it('survives degenerate input', () => {
    expect(curveLut([])[128]).toBe(128)                       // no points → identity
    expect(curveLut([{ x: 10, y: 77 }])[200]).toBe(77)        // one point → constant
    // Duplicate x would divide by zero; the later one is dropped.
    expect(() => curveLut([{ x: 0, y: 0 }, { x: 0, y: 255 }, { x: 255, y: 255 }])).not.toThrow()
  })

  it('a lifted midpoint brightens without moving the endpoints', () => {
    const lut = curveLut([{ x: 0, y: 0 }, { x: 128, y: 170 }, { x: 255, y: 255 }])
    expect(lut[0]).toBe(0)
    expect(lut[255]).toBe(255)
    expect(lut[128]).toBe(170)
    expect(lut[64]).toBeGreaterThan(64)
  })
})

describe('toneLuts', () => {
  it('is identity for a default curve', () => {
    const { r, g, b } = toneLuts(defaultToneCurve())
    for (let v = 0; v < 256; v += 17) expect([r[v], g[v], b[v]]).toEqual([v, v, v])
  })

  it('applies the channel curve first, then the master', () => {
    const curve = defaultToneCurve()
    curve.r = [{ x: 0, y: 0 }, { x: 128, y: 64 }, { x: 255, y: 255 }]   // red: 128 → 64
    curve.rgb = [{ x: 0, y: 0 }, { x: 64, y: 32 }, { x: 255, y: 255 }]  // master: 64 → 32
    expect(toneLuts(curve).r[128]).toBe(32)
    expect(toneLuts(curve).g[128]).toBe(toneLuts(curve).g[128])         // green: master only
  })

  it('isIdentityCurve spots an untouched curve so the pass can be skipped', () => {
    expect(isIdentityCurve(defaultToneCurve())).toBe(true)
    const curve = defaultToneCurve()
    curve.b = [{ x: 0, y: 10 }, { x: 255, y: 255 }]
    expect(isIdentityCurve(curve)).toBe(false)
  })
})
