import { HUE_BANDS, type Adjustments, type HslMixer, type ImageLike } from './types'
import type { ToneLuts } from './curve'

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

/** Hue centres of the eight mixer bands, in the order of HUE_BANDS. */
const BAND_HUE = [0, 30, 60, 120, 180, 240, 270, 300]

/** True when the mixer would change nothing — lets the caller skip the HSL round-trip. */
export function isIdentityMixer(hsl: HslMixer): boolean {
  return HUE_BANDS.every((b) => hsl[b].hue === 0 && hsl[b].sat === 0 && hsl[b].lum === 0)
}

/**
 * Every point operation in one pass.
 *
 * Fused deliberately: run as separate whole-image passes these would each write
 * back through a Uint8ClampedArray, so a highlight pushed past 255 by exposure
 * could never be pulled back by the curve. Inside one loop the intermediates stay
 * floats and only the final write clamps. The tone curve is the exception — a
 * 256-entry LUT has to quantise — so callers pass `luts: null` when the curve is
 * an identity, keeping the fast path lossless.
 *
 * Order follows Lightroom: white balance, exposure, contrast, tone, presence,
 * curve, colour mixer, then the post-crop effects.
 */
export function applyAdjustments(
  img: ImageLike,
  a: Adjustments,
  luts: ToneLuts | null = null,
  hsl: HslMixer | null = null,
): void {
  const { data, width, height } = img
  const C = (a.contrast / 100) * 255
  const cf = (259 * (C + 255)) / (255 * (259 - C))
  const expGain = Math.pow(2, a.exposure / 100)       // ~ +/-1 stop at +/-100
  const sat = a.saturation / 100
  const vib = a.vibrance / 100
  const warm = (a.warmth / 100) * 50
  const tint = (a.tint / 100) * 50
  const hiAmt = (a.highlights / 100) * 80
  const loAmt = (a.shadows / 100) * 80
  const whAmt = (a.whites / 100) * 90
  const blAmt = (a.blacks / 100) * 90
  const cx = (width - 1) / 2, cy = (height - 1) / 2
  const maxD = Math.hypot(cx, cy) || 1
  const vig = a.vignette / 100
  const mixing = hsl !== null && !isIdentityMixer(hsl)

  for (let p = 0, i = 0; p < width * height; p++, i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2]

    // white balance
    r += warm; b -= warm; g += tint
    // exposure (multiplicative)
    r *= expGain; g *= expGain; b *= expGain
    // contrast around mid-gray
    r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; b = cf * (b - 128) + 128

    // Tone. Highlights/shadows weight linearly by luminance; whites/blacks square
    // it, so they bite at the very ends of the range instead of the midtones.
    const L = luma(r, g, b) / 255
    const lift = hiAmt * L + loAmt * (1 - L) + whAmt * L * L + blAmt * (1 - L) * (1 - L)
    r += lift; g += lift; b += lift

    // saturation + vibrance (weight vibrance toward low-sat pixels)
    const gray = luma(r, g, b)
    const curSat = Math.max(Math.abs(r - gray), Math.abs(g - gray), Math.abs(b - gray)) / 255
    const sFactor = 1 + sat + vib * (1 - curSat)
    r = gray + (r - gray) * sFactor
    g = gray + (g - gray) * sFactor
    b = gray + (b - gray) * sFactor

    // tone curve
    if (luts) {
      r = luts.r[clamp(r) | 0]; g = luts.g[clamp(g) | 0]; b = luts.b[clamp(b) | 0]
    }

    // colour mixer
    if (mixing) {
      const m = mixPixel(r, g, b, hsl)
      r = m[0]; g = m[1]; b = m[2]
    }

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

/**
 * Monochrome film grain. Runs last, after sharpening — sharpen a grained image
 * and the sharpener amplifies the noise it finds instead of the detail.
 *
 * The noise is hashed off the pixel index rather than drawn from Math.random(),
 * so it lands in the same place every render. With a live PRNG the grain crawls
 * across the image on every slider tick, which reads as the preview flickering.
 */
export function addGrain(img: ImageLike, amount: number): void {
  if (amount <= 0) return
  const { data } = img
  const scale = (amount / 100) * 48
  for (let p = 0, i = 0; i < data.length; p++, i += 4) {
    const n = (((p * 2654435761) >>> 0) / 4294967296 - 0.5) * scale
    data[i] = clamp(data[i] + n)
    data[i + 1] = clamp(data[i + 1] + n)
    data[i + 2] = clamp(data[i + 2] + n)
  }
}

/** Scratch tuple — this runs per pixel, so it must not allocate. */
const mixed: [number, number, number] = [0, 0, 0]

/**
 * Apply the eight-band colour mixer to one pixel.
 *
 * A pixel's hue always falls between two band centres, so its correction is the
 * linear blend of those two bands — that is what keeps a saturation boost on
 * "red" from ending abruptly partway into an orange.
 */
function mixPixel(r: number, g: number, b: number, hsl: HslMixer): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) { mixed[0] = r; mixed[1] = g; mixed[2] = b; return mixed }  // grey: no hue

  const d = max - min
  const s = l > 127.5 ? d / (510 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60

  // Blend the two bands this hue sits between.
  let i = 0
  while (i < BAND_HUE.length - 1 && h >= BAND_HUE[i + 1]) i++
  const lo = HUE_BANDS[i]
  const hi = HUE_BANDS[(i + 1) % HUE_BANDS.length]
  const span = (i === BAND_HUE.length - 1 ? 360 : BAND_HUE[i + 1]) - BAND_HUE[i]
  const t = span === 0 ? 0 : (h - BAND_HUE[i]) / span
  const dHue = hsl[lo].hue + (hsl[hi].hue - hsl[lo].hue) * t
  const dSat = hsl[lo].sat + (hsl[hi].sat - hsl[lo].sat) * t
  const dLum = hsl[lo].lum + (hsl[hi].lum - hsl[lo].lum) * t

  h = (h + dHue * 0.3 + 360) % 360                       // ±30° at the extremes
  const s2 = Math.max(0, Math.min(1, s * (1 + dSat / 100)))
  const l2 = Math.max(0, Math.min(255, l + (dLum / 100) * (dLum > 0 ? 255 - l : l)))

  // HSL → RGB. Written out per segment rather than picking from an array literal:
  // this runs once per pixel, and allocating a three-element array each time cost
  // more than the entire rest of the mixer.
  const c = (1 - Math.abs((2 * l2) / 255 - 1)) * s2 * 255
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l2 - c / 2
  switch ((h / 60) | 0) {
    case 0: mixed[0] = c + m; mixed[1] = x + m; mixed[2] = m; break
    case 1: mixed[0] = x + m; mixed[1] = c + m; mixed[2] = m; break
    case 2: mixed[0] = m; mixed[1] = c + m; mixed[2] = x + m; break
    case 3: mixed[0] = m; mixed[1] = x + m; mixed[2] = c + m; break
    case 4: mixed[0] = x + m; mixed[1] = m; mixed[2] = c + m; break
    default: mixed[0] = c + m; mixed[1] = m; mixed[2] = x + m
  }
  return mixed
}
