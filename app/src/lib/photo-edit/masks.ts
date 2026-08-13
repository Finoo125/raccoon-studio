import type { ImageLike, Mask } from './types'

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

/** Hermite ease between two edges; returns 0 below `a`, 1 above `b`. */
function smoothstep(a: number, b: number, v: number): number {
  if (a === b) return v < a ? 0 : 1
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Rasterise a mask to a 0..255 alpha buffer, one byte per pixel.
 *
 * Geometry is normalised to the rendered (post-crop) canvas, matching what the
 * on-canvas overlays draw. Brush radii are a fraction of the image *width* and
 * are converted to the same pixel radius on both axes, so a round brush stays
 * round on a non-square image.
 */
export function buildMask(mask: Mask, img: ImageLike): Uint8ClampedArray {
  const { width: w, height: h } = img
  const out = new Uint8ClampedArray(w * h)
  const f = mask.feather / 100

  switch (mask.kind) {
    case 'linear': {
      const g = mask.linear
      if (!g) break
      const dx = g.bx - g.ax, dy = g.by - g.ay
      const len2 = dx * dx + dy * dy
      if (len2 === 0) break
      // Feather narrows the ramp around its midpoint; 100 keeps the full A→B ramp.
      const lo = 0.5 - f / 2, hi = 0.5 + f / 2
      for (let y = 0, p = 0; y < h; y++) {
        const ny = (y + 0.5) / h
        for (let x = 0; x < w; x++, p++) {
          const nx = (x + 0.5) / w
          const t = ((nx - g.ax) * dx + (ny - g.ay) * dy) / len2
          out[p] = smoothstep(lo, hi, t) * 255
        }
      }
      break
    }

    case 'radial': {
      const r = mask.radial
      if (!r || r.rx <= 0 || r.ry <= 0) break
      for (let y = 0, p = 0; y < h; y++) {
        const ny = (y + 0.5) / h
        for (let x = 0; x < w; x++, p++) {
          const nx = (x + 0.5) / w
          const u = (nx - r.cx) / r.rx, v = (ny - r.cy) / r.ry
          const d = Math.sqrt(u * u + v * v)
          out[p] = (1 - smoothstep(1 - f, 1, d)) * 255
        }
      }
      break
    }

    case 'brush': {
      for (const stroke of mask.brush ?? []) {
        const rad = stroke.radius * w
        if (rad <= 0) continue
        const inner = rad * (1 - f)
        for (const pt of stroke.points) {
          const cx = pt.x * w, cy = pt.y * h
          const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(w - 1, Math.ceil(cx + rad))
          const y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(h - 1, Math.ceil(cy + rad))
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
              const v = (1 - smoothstep(inner, rad, d)) * 255
              if (v === 0) continue
              const p = y * w + x
              // Strokes accumulate by maximum, so overlapping dabs within one
              // stroke stay flat instead of building up a darker seam.
              out[p] = stroke.erase ? Math.min(out[p], 255 - v) : Math.max(out[p], v)
            }
          }
        }
      }
      break
    }

    case 'luminance': {
      const r = mask.luminance
      if (!r) break
      const edge = f * 64 + 1   // feather in luminance levels
      const d = img.data
      for (let p = 0, i = 0; p < out.length; p++, i += 4) {
        const L = luma(d[i], d[i + 1], d[i + 2])
        out[p] = smoothstep(r.min - edge, r.min + edge, L) *
          (1 - smoothstep(r.max - edge, r.max + edge, L)) * 255
      }
      break
    }
  }

  if (mask.invert) for (let p = 0; p < out.length; p++) out[p] = 255 - out[p]
  return out
}

/** True when a mask would change nothing, so the render can skip its whole layer. */
export function isNoopMask(mask: Mask): boolean {
  const a = mask.adjustments
  return Object.values(a).every((v) => v === 0)
}
