import type { ImageLike } from './types'

export interface Histogram {
  r: Uint32Array; g: Uint32Array; b: Uint32Array; luma: Uint32Array
  /** Tallest bin across the three channels — the scale the plot normalises to. */
  peak: number
  /** Fraction of pixels sitting at 0 / at 255, i.e. crushed or blown. */
  clippedLow: number
  clippedHigh: number
}

/**
 * 256-bin histogram of an already-edited frame.
 *
 * `peak` ignores bins 0 and 255: a photo with a large flat black background
 * spikes bin 0 far above everything else, and normalising to that spike flattens
 * the rest of the plot into an unreadable line.
 */
export function computeHistogram(img: ImageLike): Histogram {
  const r = new Uint32Array(256), g = new Uint32Array(256)
  const b = new Uint32Array(256), luma = new Uint32Array(256)
  const d = img.data
  let low = 0, high = 0
  const n = d.length / 4

  for (let i = 0; i < d.length; i += 4) {
    const vr = d[i], vg = d[i + 1], vb = d[i + 2]
    r[vr]++; g[vg]++; b[vb]++
    luma[(0.299 * vr + 0.587 * vg + 0.114 * vb) | 0]++
    if (vr === 0 && vg === 0 && vb === 0) low++
    if (vr === 255 && vg === 255 && vb === 255) high++
  }

  let peak = 1
  for (let v = 1; v < 255; v++) {
    if (r[v] > peak) peak = r[v]
    if (g[v] > peak) peak = g[v]
    if (b[v] > peak) peak = b[v]
  }

  return { r, g, b, luma, peak, clippedLow: n ? low / n : 0, clippedHigh: n ? high / n : 0 }
}
