/**
 * Downscale an image File so its longest side is <= `max`px and return a raw
 * base64 JPEG (no data: prefix) for the enhance LLM's vision pass. Browser-
 * only (uses createImageBitmap + canvas).
 */
export async function downscaleFileToB64(file: File, max = 768): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const long = Math.max(bitmap.width, bitmap.height)
  const scale = long > max ? max / long : 1
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', 0.85).split(',', 2)[1] ?? ''
}
