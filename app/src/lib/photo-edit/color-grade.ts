import type { ColorGrade, ImageLike } from './types'

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
const luma = (r: number, g: number, b: number) => (0.299 * r + 0.587 * g + 0.114 * b) / 255

/**
 * Three-way color grade. For each pixel, compute luminance L (0..1), bias it by
 * `balance`, then blend the pixel toward the tint that L selects — shadow below
 * the midpoint, highlight above, passing through midtone at L = 0.5.
 * `strength <= 0` is a no-op. Alpha is preserved.
 *
 * An absent `midtone` defaults to the midpoint of shadow and highlight, which is
 * exactly the value a straight shadow→highlight lerp already passed through — so
 * two-tone presets written before midtones existed grade identically.
 */
export function applyColorGrade(img: ImageLike, grade: ColorGrade, strength: number): void {
  if (strength <= 0) return
  const s = strength > 1 ? 1 : strength
  const { data } = img
  const [sr, sg, sb] = grade.shadow
  const [hr, hg, hb] = grade.highlight
  const [mr, mg, mb] = grade.midtone ?? [(sr + hr) / 2, (sg + hg) / 2, (sb + hb) / 2]
  const bias = grade.balance / 100 // -1..1

  for (let i = 0; i < data.length; i += 4) {
    let L = luma(data[i], data[i + 1], data[i + 2]) + bias
    L = L < 0 ? 0 : L > 1 ? 1 : L
    // Two half-ramps: shadow→midtone below 0.5, midtone→highlight above.
    const t = L < 0.5 ? L * 2 : (L - 0.5) * 2
    const [ar, ag, ab] = L < 0.5 ? [sr, sg, sb] : [mr, mg, mb]
    const [br, bg, bb] = L < 0.5 ? [mr, mg, mb] : [hr, hg, hb]
    const tr = ar + (br - ar) * t
    const tg = ag + (bg - ag) * t
    const tb = ab + (bb - ab) * t
    data[i] = clamp(data[i] + (tr - data[i]) * s)
    data[i + 1] = clamp(data[i + 1] + (tg - data[i + 1]) * s)
    data[i + 2] = clamp(data[i + 2] + (tb - data[i + 2]) * s)
  }
}
