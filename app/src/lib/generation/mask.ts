/**
 * Mask helpers for inpainting. The MaskBrush paints translucent strokes over the
 * base image; before sending to ComfyUI those strokes must become a binary PNG
 * mask. ComfyUI's `LoadImageMask` reads the red channel and `SetLatentNoiseMask`
 * regenerates wherever the mask is white, so **white = "repaint this area"**.
 */

export interface MaskOptions {
  /** Treat which side as white. Default: painted strokes → white. */
  invert?: boolean
  /** Minimum alpha (0-255) for a pixel to count as painted. Default 1. */
  threshold?: number
}

/**
 * Converts a painted brush layer's RGBA buffer into a binary mask buffer:
 * painted pixels become opaque white, everything else opaque black (or the
 * reverse when `invert` is set). Only the alpha channel of the source matters —
 * the brush colour is irrelevant. Pure and dimension-agnostic so it can be
 * unit-tested without a DOM canvas; returns a new buffer, never mutating `src`.
 */
export function maskPixels(src: Uint8ClampedArray, options: MaskOptions = {}): Uint8ClampedArray {
  const threshold = options.threshold ?? 1
  const invert = options.invert ?? false
  const out = new Uint8ClampedArray(src.length)
  for (let i = 0; i < src.length; i += 4) {
    const painted = src[i + 3] >= threshold
    const white = invert ? !painted : painted
    const v = white ? 255 : 0
    out[i] = v
    out[i + 1] = v
    out[i + 2] = v
    out[i + 3] = 255
  }
  return out
}

/** True if any pixel in the brush layer is painted at/above `threshold` (1 by default). */
export function hasPaintedPixels(src: Uint8ClampedArray, threshold = 1): boolean {
  for (let i = 3; i < src.length; i += 4) {
    if (src[i] >= threshold) return true
  }
  return false
}

/**
 * Renders a painted brush canvas to a binary black/white PNG `Blob` ready to
 * upload as an inpaint mask. DOM-only wrapper around {@link maskPixels}.
 */
export async function canvasToMaskBlob(
  canvas: HTMLCanvasElement,
  options: MaskOptions = {},
): Promise<Blob> {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  const { width, height } = canvas
  const { data } = ctx.getImageData(0, 0, width, height)
  const masked = maskPixels(data, options)

  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const octx = out.getContext('2d')
  if (!octx) throw new Error('2D canvas context unavailable')
  const outData = octx.createImageData(width, height)
  outData.data.set(masked)
  octx.putImageData(outData, 0, 0)

  return await new Promise<Blob>((resolve, reject) => {
    out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('mask toBlob failed'))), 'image/png')
  })
}
