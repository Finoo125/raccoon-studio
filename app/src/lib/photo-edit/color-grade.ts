import type { ColorGrade, ImageLike } from './types'

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
const luma = (r: number, g: number, b: number) => (0.299 * r + 0.587 * g + 0.114 * b) / 255

/**
 * Split-tone color grade. For each pixel, compute luminance L (0..1), bias it by
 * `balance`, then blend the pixel toward lerp(shadow, highlight, L) by `strength`.
 * `strength <= 0` is a no-op. Alpha is preserved.
 */
export function applyColorGrade(img: ImageLike, grade: ColorGrade, strength: number): void {
  if (strength <= 0) return
  const s = strength > 1 ? 1 : strength
  const { data } = img
  const [sr, sg, sb] = grade.shadow
  const [hr, hg, hb] = grade.highlight
  const bias = grade.balance / 100 // -1..1

  for (let i = 0; i < data.length; i += 4) {
    let L = luma(data[i], data[i + 1], data[i + 2]) + bias
    L = L < 0 ? 0 : L > 1 ? 1 : L
    const tr = sr + (hr - sr) * L
    const tg = sg + (hg - sg) * L
    const tb = sb + (hb - sb) * L
    data[i] = clamp(data[i] + (tr - data[i]) * s)
    data[i + 1] = clamp(data[i + 1] + (tg - data[i + 1]) * s)
    data[i + 2] = clamp(data[i + 2] + (tb - data[i + 2]) * s)
  }
}
