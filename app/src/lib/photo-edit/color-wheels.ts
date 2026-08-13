import type { ColorWheels, ImageLike, WheelStop } from './types'

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
const luma = (r: number, g: number, b: number) => (0.299 * r + 0.587 * g + 0.114 * b) / 255

/** Strongest colour push a fully-saturated wheel can apply, in 0..255 units. */
const MAX_PUSH = 72
/** Strongest luminance push per zone, in 0..255 units. */
const MAX_LUM = 90

/**
 * A wheel's colour as a signed RGB offset around neutral.
 *
 * Signed is the whole point: the preset grades blend *toward* an absolute colour,
 * which is right for a duotone but wrong for a grading wheel — at zero saturation
 * the tint is mid-grey, and blending toward grey drains the image. An offset of
 * zero is genuinely nothing, so a centred wheel is a true no-op.
 */
function offsetOf(stop: WheelStop): [number, number, number] {
  const s = Math.max(0, Math.min(100, stop.sat)) / 100
  if (s === 0) return [0, 0, 0]
  const h = ((stop.hue % 360) + 360) % 360
  // HSL(h, 1, 0.5) → RGB, recentred on grey.
  const c = 255, x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  let r: number, g: number, b: number
  switch ((h / 60) | 0) {
    case 0: [r, g, b] = [c, x, 0]; break
    case 1: [r, g, b] = [x, c, 0]; break
    case 2: [r, g, b] = [0, c, x]; break
    case 3: [r, g, b] = [0, x, c]; break
    case 4: [r, g, b] = [x, 0, c]; break
    default: [r, g, b] = [c, 0, x]
  }
  const k = (s * MAX_PUSH) / 127.5
  return [(r - 127.5) * k, (g - 127.5) * k, (b - 127.5) * k]
}

export function isNeutralWheels(w: ColorWheels): boolean {
  return [w.shadows, w.midtones, w.highlights].every((s) => s.sat === 0 && s.lum === 0)
}

/**
 * Three-way colour grading. Each pixel's luminance splits it between the shadow,
 * midtone and highlight zones; each zone contributes its colour offset and its
 * luminance push in proportion.
 *
 * `balance` slides the split toward shadows or highlights, `blending` scales the
 * whole result — the two controls Lightroom puts under its wheels.
 */
export function applyColorWheels(img: ImageLike, wheels: ColorWheels): void {
  if (isNeutralWheels(wheels)) return
  const { data } = img
  const amount = wheels.blending / 100
  if (amount <= 0) return

  const [sr, sg, sb] = offsetOf(wheels.shadows)
  const [mr, mg, mb] = offsetOf(wheels.midtones)
  const [hr, hg, hb] = offsetOf(wheels.highlights)
  const sL = (wheels.shadows.lum / 100) * MAX_LUM
  const mL = (wheels.midtones.lum / 100) * MAX_LUM
  const hL = (wheels.highlights.lum / 100) * MAX_LUM
  const bias = wheels.balance / 100

  for (let i = 0; i < data.length; i += 4) {
    let L = luma(data[i], data[i + 1], data[i + 2]) - bias * 0.5
    L = L < 0 ? 0 : L > 1 ? 1 : L
    // Triangular weights: shadows fade out by the midpoint, highlights fade in
    // after it, and the midtones take up whatever the other two leave.
    const wS = Math.max(0, 1 - L * 2)
    const wH = Math.max(0, L * 2 - 1)
    const wM = 1 - wS - wH

    const dr = (sr * wS + mr * wM + hr * wH + sL * wS + mL * wM + hL * wH) * amount
    const dg = (sg * wS + mg * wM + hg * wH + sL * wS + mL * wM + hL * wH) * amount
    const db = (sb * wS + mb * wM + hb * wH + sL * wS + mL * wM + hL * wH) * amount
    data[i] = clamp(data[i] + dr)
    data[i + 1] = clamp(data[i + 1] + dg)
    data[i + 2] = clamp(data[i + 2] + db)
  }
}
