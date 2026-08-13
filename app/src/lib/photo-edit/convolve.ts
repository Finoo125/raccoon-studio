import type { ImageLike } from './types'
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

/**
 * Separable box blur with a sliding window: each output pixel adds the sample
 * entering the window and subtracts the one leaving, so the cost is constant in
 * `radius` rather than 2r+1 taps per pixel per axis.
 *
 * That distinction is the whole budget at preview size — summing the window per
 * pixel put a radius-6 clarity pass at ~156 ms on a 1600×900 frame, which is a
 * visibly stuttering slider. Edges clamp, matching the previous behaviour.
 */
export function boxBlur(img: ImageLike, radius: number): void {
  if (radius < 1) return
  const { data, width: w, height: h } = img
  const tmp = new Float32Array(data.length)
  const span = radius * 2 + 1

  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let c = 0; c < 3; c++) {
      // Seed the window at x = 0, with the left edge clamped onto pixel 0.
      let sum = data[row * 4 + c] * (radius + 1)
      for (let k = 1; k <= radius; k++) sum += data[(row + Math.min(w - 1, k)) * 4 + c]
      for (let x = 0; x < w; x++) {
        tmp[(row + x) * 4 + c] = sum / span
        sum += data[(row + Math.min(w - 1, x + radius + 1)) * 4 + c]
          - data[(row + Math.max(0, x - radius)) * 4 + c]
      }
    }
  }

  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = tmp[x * 4 + c] * (radius + 1)
      for (let k = 1; k <= radius; k++) sum += tmp[(Math.min(h - 1, k) * w + x) * 4 + c]
      for (let y = 0; y < h; y++) {
        data[(y * w + x) * 4 + c] = clamp(sum / span)
        sum += tmp[(Math.min(h - 1, y + radius + 1) * w + x) * 4 + c]
          - tmp[(Math.max(0, y - radius) * w + x) * 4 + c]
      }
    }
  }
}

/**
 * Unsharp mask. A negative `amount` blends *toward* the blur instead, which is
 * what a negative Clarity/Texture slider is: local-contrast softening.
 */
export function unsharpMask(img: ImageLike, radius: number, amount: number): void {
  if (amount === 0 || radius < 1) return
  const orig = new Uint8ClampedArray(img.data)
  boxBlur(img, radius) // img now holds the blurred version
  const { data } = img
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const o = orig[i + c]
      data[i + c] = clamp(o + amount * (o - data[i + c]))
    }
  }
}

/** Window radius for the dark-channel min filter, in pixels. */
const DEHAZE_RADIUS = 7

/**
 * Dehaze via the dark-channel prior (He et al.), without the soft-matting
 * refinement: haze is estimated from the fact that a haze-free patch almost
 * always has one very dark colour channel, so where the local minimum across
 * channels is *bright*, the patch is veiled — and that veil can be divided out.
 *
 * `amount` is -1..1; negative adds haze by blending toward the atmospheric light.
 *
 * ponytail: plain box minimum, O(radius) per pixel. Only runs when the slider is
 * off zero. A van Herk running minimum would make it O(1) if that ever matters.
 */
export function dehaze(img: ImageLike, amount: number): void {
  if (amount === 0) return
  const { data, width: w, height: h } = img
  const n = w * h

  // Per-pixel darkest channel, then a min over the window (separable).
  const dark = new Uint8ClampedArray(n)
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    dark[p] = Math.min(data[i], data[i + 1], data[i + 2])
  }
  const tmp = new Uint8ClampedArray(n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 255
      for (let k = -DEHAZE_RADIUS; k <= DEHAZE_RADIUS; k++) {
        const xx = x + k
        if (xx >= 0 && xx < w) m = Math.min(m, dark[y * w + xx])
      }
      tmp[y * w + x] = m
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 255
      for (let k = -DEHAZE_RADIUS; k <= DEHAZE_RADIUS; k++) {
        const yy = y + k
        if (yy >= 0 && yy < h) m = Math.min(m, tmp[yy * w + x])
      }
      dark[y * w + x] = m
    }
  }

  // Atmospheric light: mean colour of the haziest 0.1% of pixels.
  const hist = new Uint32Array(256)
  for (let p = 0; p < n; p++) hist[dark[p]]++
  let cut = 255, seen = 0
  const target = Math.max(1, Math.round(n * 0.001))
  for (let v = 255; v >= 0; v--) { seen += hist[v]; if (seen >= target) { cut = v; break } }
  let ar = 0, ag = 0, ab = 0, count = 0
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (dark[p] >= cut) { ar += data[i]; ag += data[i + 1]; ab += data[i + 2]; count++ }
  }
  const A = [Math.max(1, ar / count), Math.max(1, ag / count), Math.max(1, ab / count)]

  if (amount < 0) {
    // Adding haze needs none of the above except A — just wash toward it.
    const k = -amount
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) data[i + c] = clamp(data[i + c] * (1 - k) + A[c] * k)
    }
    return
  }

  const omega = 0.95 * amount
  const minT = 0.1
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    // Transmission, from how bright the local dark channel is relative to A.
    const t = Math.max(minT, 1 - (omega * dark[p]) / Math.max(A[0], A[1], A[2]))
    for (let c = 0; c < 3; c++) data[i + c] = clamp((data[i + c] - A[c]) / t + A[c])
  }
}
