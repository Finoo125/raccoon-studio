import type { Crop, Slice } from './types'

export function orientedSize(w: number, h: number, rotate: number) {
  return rotate === 90 || rotate === 270 ? { width: h, height: w } : { width: w, height: h }
}

export function cropToPixels(c: Crop, w: number, h: number) {
  return { x: Math.round(c.x * w), y: Math.round(c.y * h), w: Math.round(c.w * w), h: Math.round(c.h * h) }
}

export function normalizeCrop(px: { x: number; y: number; w: number; h: number }, w: number, h: number): Crop {
  return { x: px.x / w, y: px.y / h, w: px.w / w, h: px.h / h }
}

export type Grip = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

/** Smallest crop we allow, as a fraction of the image — below this the handles overlap. */
const MIN_CROP = 0.03

/**
 * Apply a drag of (dx, dy) to a crop rect, clamped to the image and to MIN_CROP.
 * All coordinates are normalised to the oriented (post-rotate) image.
 *
 * `lock` is a *pixel* aspect ratio (w/h), so it has to be converted through the
 * oriented image size before it can be applied: 1:1 on an 832×1216 image is not
 * `w === h` in normalised units.
 */
export function resizeCrop(
  from: Crop, grip: Grip, dx: number, dy: number,
  lock: number | null, ow: number, oh: number,
): Crop {
  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

  if (grip === 'move') {
    return {
      ...from,
      x: clamp01(Math.min(from.x + dx, 1 - from.w)),
      y: clamp01(Math.min(from.y + dy, 1 - from.h)),
    }
  }

  let { x, y, w, h } = from
  if (grip.includes('w')) { const nx = clamp01(Math.min(x + dx, x + w - MIN_CROP)); w += x - nx; x = nx }
  if (grip.includes('e')) { w = Math.max(MIN_CROP, Math.min(1 - x, w + dx)) }
  if (grip.includes('n')) { const ny = clamp01(Math.min(y + dy, y + h - MIN_CROP)); h += y - ny; y = ny }
  if (grip.includes('s')) { h = Math.max(MIN_CROP, Math.min(1 - y, h + dy)) }

  if (lock !== null) {
    // The normalised height that yields the locked pixel ratio at this width.
    const nh = Math.min(1, (w * ow) / (lock * oh))
    // Anchor the edge the drag isn't moving, so the opposite corner stays put.
    if (grip.includes('n')) y = Math.max(0, y + h - nh)
    h = Math.min(nh, 1 - y)
  }

  return { x, y, w, h }
}

/**
 * Where to draw the "this half goes" veil for a slice.
 *
 * The overlay covers the discarded half with one big rect laid along the cut and
 * rotated onto it — the SVG viewport clips the overhang, so no polygon clipping
 * is needed, and an affine viewBox keeps the veil's edge exactly on the line.
 *
 * The sign is the whole point, and it is easy to get backwards: rotating by
 * `atan2(dy, dx)` sends the rect's local +y to the side where `applySliceMask`
 * computes `cross > 0` — which is the side `keep: 'a'` *keeps*. So the discarded
 * half is local −y for 'a' and local +y for 'b'.
 */
export interface SliceVeil {
  /** Rotation of the veil rect, in degrees. */
  angle: number
  /** Local y of the rect's near edge: -VEIL_SPAN above the cut, or 0 below it. */
  y: number
  /** Where to put the "Removed" tag, in normalised image coordinates. */
  label: { x: number; y: number }
}

/** Half-extent of the veil rect. The unit square's diagonal is √2, so 3 covers it. */
export const VEIL_SPAN = 3

export function sliceVeil(slice: Slice): SliceVeil | null {
  const dx = slice.bx - slice.ax
  const dy = slice.by - slice.ay
  const len = Math.hypot(dx, dy)
  if (len === 0) return null

  const keepsA = slice.keep === 'a'
  // Unit normal pointing at the side `keep: 'a'` keeps.
  const nx = -dy / len
  const ny = dx / len
  // ...so the discarded side is the other way when 'a' is kept.
  const sign = keepsA ? -1 : 1
  const clamp = (v: number) => (v < 0.08 ? 0.08 : v > 0.92 ? 0.92 : v)

  return {
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    y: keepsA ? -VEIL_SPAN : 0,
    label: {
      x: clamp((slice.ax + slice.bx) / 2 + nx * sign * 0.16),
      y: clamp((slice.ay + slice.by) / 2 + ny * sign * 0.16),
    },
  }
}

export const ASPECT_RATIOS = [
  { id: 'original', label: 'Original', value: null as number | null },
  { id: '1:1', label: '1:1', value: 1 },
  { id: '4:3', label: '4:3', value: 4 / 3 },
  { id: '3:2', label: '3:2', value: 3 / 2 },
  { id: '16:9', label: '16:9', value: 16 / 9 },
  { id: '9:16', label: '9:16', value: 9 / 16 },
]
