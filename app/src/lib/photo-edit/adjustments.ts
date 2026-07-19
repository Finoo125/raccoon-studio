import type { Adjustments, ImageLike } from './types'

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

export function applyAdjustments(img: ImageLike, a: Adjustments): void {
  const { data, width, height } = img
  // contrast factor (standard)
  const C = (a.contrast / 100) * 255
  const cf = (259 * (C + 255)) / (255 * (259 - C))
  const expGain = Math.pow(2, a.exposure / 100)       // ~ +/-1 stop at +/-100
  const bright = (a.brightness / 100) * 128
  const sat = a.saturation / 100
  const vib = a.vibrance / 100
  const warm = (a.warmth / 100) * 50
  const tint = (a.tint / 100) * 50
  const cx = (width - 1) / 2, cy = (height - 1) / 2
  const maxD = Math.hypot(cx, cy) || 1
  const vig = a.vignette / 100

  for (let p = 0, i = 0; p < width * height; p++, i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2]

    // exposure (multiplicative) + brightness (additive)
    r = r * expGain + bright; g = g * expGain + bright; b = b * expGain + bright
    // contrast around mid-gray
    r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; b = cf * (b - 128) + 128
    // highlights / shadows (luminance-masked additive)
    const L = luma(r, g, b) / 255
    const hi = (a.highlights / 100) * 80 * L
    const lo = (a.shadows / 100) * 80 * (1 - L)
    r += hi + lo; g += hi + lo; b += hi + lo
    // warmth / tint
    r += warm; b -= warm; g += tint
    // saturation + vibrance (weight vibrance toward low-sat pixels)
    const gray = luma(r, g, b)
    const curSat = Math.max(Math.abs(r - gray), Math.abs(g - gray), Math.abs(b - gray)) / 255
    const sFactor = 1 + sat + vib * (1 - curSat)
    r = gray + (r - gray) * sFactor
    g = gray + (g - gray) * sFactor
    b = gray + (b - gray) * sFactor
    // vignette
    if (vig !== 0) {
      const x = p % width, y = (p / width) | 0
      const d = Math.hypot(x - cx, y - cy) / maxD
      const factor = 1 - vig * d * d
      r *= factor; g *= factor; b *= factor
    }

    data[i] = clamp(r); data[i + 1] = clamp(g); data[i + 2] = clamp(b)
  }
}
