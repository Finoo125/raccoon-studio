import type { EditState, ImageLike, Slice } from './types'
import { applyAdjustments } from './adjustments'
import { unsharpMask } from './convolve'
import { applyColorGrade } from './color-grade'
import { PRESETS, applyPreset } from './presets'

export function applyEdit(img: ImageLike, state: EditState): void {
  const preset = PRESETS.find((p) => p.id === state.filter.id) ?? PRESETS[0]
  const adj = applyPreset(state.adjustments, preset, state.filter.intensity)
  applyAdjustments(img, adj)
  if (preset.grade) applyColorGrade(img, preset.grade, state.filter.intensity)
  if (adj.clarity > 0) unsharpMask(img, 6, (adj.clarity / 100) * 0.8)
  if (adj.sharpness > 0) unsharpMask(img, 1, (adj.sharpness / 100) * 1.5)
  if (state.slice) applySliceMask(img, state.slice)
}

/** Zero the alpha of pixels on the discarded side of the slice line. */
export function applySliceMask(img: ImageLike, slice: Slice): void {
  const { data, width, height } = img
  const { ax, ay, bx, by, keep } = slice
  const dx = bx - ax, dy = by - ay
  for (let y = 0; y < height; y++) {
    const ny = (y + 0.5) / height
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5) / width
      const cross = dx * (ny - ay) - dy * (nx - ax)
      const onKeepSide = keep === 'a' ? cross >= 0 : cross < 0
      if (!onKeepSide) data[(y * width + x) * 4 + 3] = 0
    }
  }
}

// Applies geometry (rotate/flip/straighten/crop) into `canvas`, then runs applyEdit on the pixels.
export function renderToCanvas(
  source: ImageBitmap | HTMLImageElement,
  state: EditState,
  canvas: HTMLCanvasElement,
): void {
  const sw = source.width, sh = source.height
  const rot = state.rotate
  const ow = rot === 90 || rot === 270 ? sh : sw
  const oh = rot === 90 || rot === 270 ? sw : sh
  canvas.width = state.crop ? Math.round(state.crop.w * ow) : ow
  canvas.height = state.crop ? Math.round(state.crop.h * oh) : oh
  const ctx = canvas.getContext('2d')!
  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(((rot + state.straighten) * Math.PI) / 180)
  ctx.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1)
  const dx = state.crop ? -(state.crop.x + state.crop.w / 2) * ow : -ow / 2
  const dy = state.crop ? -(state.crop.y + state.crop.h / 2) * oh : -oh / 2
  ctx.drawImage(source, dx + (rot === 90 || rot === 270 ? (ow - oh) / 2 : 0), dy, ow, oh)
  ctx.restore()
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height)
  applyEdit({ data: id.data, width: id.width, height: id.height }, state)
  ctx.putImageData(id, 0, 0)
}
