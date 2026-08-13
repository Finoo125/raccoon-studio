import { IDENTITY_CURVE, type CurvePoint, type ToneCurve } from './types'

/**
 * Build a 256-entry lookup table from tone-curve control points.
 *
 * Interpolation is monotone cubic (Fritsch–Carlson): a plain cubic spline
 * overshoots between close control points, which on a tone curve shows up as
 * inverted contrast — a highlight that gets *darker* as you drag the point up.
 * Monotone tangents cost four lines and make that impossible.
 */
export function curveLut(points: CurvePoint[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256)

  // Sort by x and drop duplicate x values — two points on the same input level
  // have no defined slope between them.
  const p = [...points].sort((a, b) => a.x - b.x).filter((pt, i, arr) => i === 0 || pt.x !== arr[i - 1].x)
  if (p.length < 2) {
    for (let v = 0; v < 256; v++) lut[v] = p.length === 1 ? p[0].y : v
    return lut
  }

  const n = p.length
  const d: number[] = []                       // secant slopes
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1].y - p[i].y) / (p[i + 1].x - p[i].x))

  const m: number[] = [d[0]]                   // tangents
  for (let i = 1; i < n - 1; i++) m.push((d[i - 1] + d[i]) / 2)
  m.push(d[n - 2])

  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue }
    const a = m[i] / d[i], b = m[i + 1] / d[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * d[i]
      m[i + 1] = t * b * d[i]
    }
  }

  let seg = 0
  for (let v = 0; v < 256; v++) {
    if (v <= p[0].x) { lut[v] = p[0].y; continue }
    if (v >= p[n - 1].x) { lut[v] = p[n - 1].y; continue }
    while (seg < n - 2 && v > p[seg + 1].x) seg++
    const h = p[seg + 1].x - p[seg].x
    const t = (v - p[seg].x) / h
    const t2 = t * t, t3 = t2 * t
    lut[v] =
      (2 * t3 - 3 * t2 + 1) * p[seg].y +
      (t3 - 2 * t2 + t) * h * m[seg] +
      (-2 * t3 + 3 * t2) * p[seg + 1].y +
      (t3 - t2) * h * m[seg + 1]
  }
  return lut
}

export interface ToneLuts { r: Uint8ClampedArray; g: Uint8ClampedArray; b: Uint8ClampedArray }

const isIdentity = (p: CurvePoint[]) =>
  p.length === IDENTITY_CURVE.length && p.every((pt, i) => pt.x === IDENTITY_CURVE[i].x && pt.y === IDENTITY_CURVE[i].y)

/** True when the curve would leave every value untouched — lets callers skip the pass. */
export function isIdentityCurve(curve: ToneCurve): boolean {
  return isIdentity(curve.rgb) && isIdentity(curve.r) && isIdentity(curve.g) && isIdentity(curve.b)
}

/**
 * Collapse the four curves into one LUT per channel: the channel curve runs
 * first, then the master, which is the order every editor applies them in.
 */
export function toneLuts(curve: ToneCurve): ToneLuts {
  const master = curveLut(curve.rgb)
  const compose = (points: CurvePoint[]) => {
    const own = curveLut(points)
    const out = new Uint8ClampedArray(256)
    for (let v = 0; v < 256; v++) out[v] = master[own[v]]
    return out
  }
  return { r: compose(curve.r), g: compose(curve.g), b: compose(curve.b) }
}
