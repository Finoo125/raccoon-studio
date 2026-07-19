import type { Adjustments, ImageLike } from './types'

const clampAdj = (v: number) => Math.round(v < -100 ? -100 : v > 100 ? 100 : v)
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

/**
 * Heuristic auto-enhance: reads a luminance histogram for auto exposure/contrast,
 * a gray-world average for white-balance (warmth/tint), and mean saturation for a
 * vibrance bump. Returns only the keys it sets, each clamped to the slider range.
 * Pure — caller is responsible for any downscale before calling.
 */
export function computeAutoAdjustments(img: ImageLike): Partial<Adjustments> {
  const { data } = img
  const n = data.length / 4
  if (n === 0) return {}

  const hist = new Array<number>(256).fill(0)
  let sumR = 0, sumG = 0, sumB = 0, sumSat = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    sumR += r; sumG += g; sumB += b
    const L = luma(r, g, b)
    hist[Math.min(255, Math.max(0, Math.round(L)))]++
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    sumSat += mx === 0 ? 0 : (mx - mn) / mx
  }

  // Percentile black/white points (0.5% / 99.5%).
  const lowCut = n * 0.005, highCut = n * 0.995
  let acc = 0, black = 0, white = 255
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= lowCut) { black = v; break } }
  acc = 0
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= highCut) { white = v; break } }

  const out: Partial<Adjustments> = {}

  // Auto-contrast: the narrower the used range, the more contrast we add.
  const range = Math.max(1, white - black)
  if (range < 255) out.contrast = clampAdj(((255 - range) / 255) * 60)

  // Auto-exposure: nudge a dark or bright image toward mid.
  const mid = (black + white) / 2
  if (Math.abs(mid - 128) > 8) out.exposure = clampAdj(((128 - mid) / 128) * 40)

  // Gray-world white balance.
  const avgR = sumR / n, avgG = sumG / n, avgB = sumB / n
  const gray = (avgR + avgG + avgB) / 3
  const warmth = clampAdj(((gray - avgR) - (gray - avgB)) / 2 * (100 / 64))
  if (Math.abs(warmth) > 2) out.warmth = warmth
  const tint = clampAdj((gray - avgG) * (100 / 64))
  if (Math.abs(tint) > 2) out.tint = tint

  // Vibrance bump for flat images.
  const meanSat = sumSat / n
  if (meanSat < 0.35) out.vibrance = clampAdj((0.35 - meanSat) * 120)

  return out
}
