import type { ImageLike } from './types'
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

export function boxBlur(img: ImageLike, radius: number): void {
  if (radius < 1) return
  const { data, width: w, height: h } = img
  const tmp = new Float32Array(data.length)
  const span = radius * 2 + 1
  // horizontal
  for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k))
        sum += data[(y * w + xx) * 4 + c]
      }
      tmp[(y * w + x) * 4 + c] = sum / span
    }
  }
  // vertical
  for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      let sum = 0
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k))
        sum += tmp[(yy * w + x) * 4 + c]
      }
      data[(y * w + x) * 4 + c] = clamp(sum / span)
    }
  }
}

export function unsharpMask(img: ImageLike, radius: number, amount: number): void {
  if (amount <= 0 || radius < 1) return
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
