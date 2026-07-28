/**
 * Downscale an image File so its longest side is <= `max`px and return a raw
 * base64 JPEG (no data: prefix) for the enhance LLM's vision pass. Browser-
 * only (uses createImageBitmap + canvas).
 */
export async function downscaleFileToB64(file: Blob, max = 768): Promise<string> {
  return (await downscaleToB64AndDims(file, max)).b64
}

/**
 * Same downscale pass, but also reports the source's own pixel size — callers
 * that need both (an i2v seed: b64 for the vision pass, dims to drive the clip
 * resolution) get them from a single decode.
 */
export async function downscaleToB64AndDims(
  file: Blob,
  max = 768,
): Promise<{ b64: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const long = Math.max(bitmap.width, bitmap.height)
  const scale = long > max ? max / long : 1
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, w, h)
  return {
    b64: canvas.toDataURL('image/jpeg', 0.85).split(',', 2)[1] ?? '',
    width: bitmap.width,
    height: bitmap.height,
  }
}
