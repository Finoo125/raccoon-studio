import type { Adjustments, ColorGrade, ColorWheels, EditState, HslMixer, ImageLike, Slice } from './types'
import { addGrain, applyAdjustments } from './adjustments'
import { dehaze, unsharpMask } from './convolve'
import { isIdentityCurve, toneLuts, type ToneLuts } from './curve'
import { applyColorGrade } from './color-grade'
import { applyColorWheels } from './color-wheels'
import { buildMask, isNoopMask } from './masks'
import { PRESETS, applyPreset } from './presets'

/** The whole-image extras that sit alongside the sliders: curve, mixer, grades. */
interface Look {
  luts: ToneLuts | null
  hsl: HslMixer | null
  /** The selected preset's duotone, if it has one. */
  grade: ColorGrade | null
  gradeStrength: number
  /** The user's three grading wheels. */
  wheels: ColorWheels | null
}

/**
 * Presence (local contrast), then every point operation in one fused pass, then
 * the grade, then sharpening and grain.
 *
 * Split this way because the presence sliders are convolutions — they need the
 * neighbouring pixels — while everything between them and the sharpener is a
 * per-pixel function that can share a single loop and a single clamp.
 */
function applyLook(img: ImageLike, adj: Adjustments, look: Look): void {
  if (adj.dehaze !== 0) dehaze(img, adj.dehaze / 100)
  if (adj.texture !== 0) unsharpMask(img, 2, (adj.texture / 100) * 0.9)
  if (adj.clarity !== 0) unsharpMask(img, 6, (adj.clarity / 100) * 0.8)

  applyAdjustments(img, adj, look.luts, look.hsl)

  if (look.grade) applyColorGrade(img, look.grade, look.gradeStrength)
  if (look.wheels) applyColorWheels(img, look.wheels)
  if (adj.sharpness > 0) unsharpMask(img, 1, (adj.sharpness / 100) * 1.5)
  addGrain(img, adj.grain)
}

export function applyEdit(img: ImageLike, state: EditState): void {
  const preset = PRESETS.find((p) => p.id === state.filter.id) ?? PRESETS[0]
  const adj = applyPreset(state.adjustments, preset, state.filter.intensity)

  applyLook(img, adj, {
    luts: isIdentityCurve(state.curve) ? null : toneLuts(state.curve),
    hsl: state.hsl,
    grade: preset.grade ?? null,
    gradeStrength: state.filter.intensity,
    wheels: state.wheels,
  })

  // Local adjustments: re-run the sliders over a copy under each mask's settings
  // and blend that in by the mask's alpha. Masked sliders are the same sliders,
  // so there is one implementation of what a slider means, not two.
  //
  // The curve, mixer and grade are deliberately absent here: they have already
  // been applied to the pixels this layer is copied from, and running them again
  // inside the masked region would double them.
  const NO_LOOK: Look = { luts: null, hsl: null, grade: null, gradeStrength: 0, wheels: null }
  for (const mask of state.masks) {
    if (isNoopMask(mask)) continue
    const alpha = buildMask(mask, img)
    const layer: ImageLike = { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height }
    applyLook(layer, mask.adjustments, NO_LOOK)
    blend(img, layer, alpha)
  }

  if (state.slice) applySliceMask(img, state.slice)
}

/** Lerp `layer` over `base` by a 0..255 per-pixel alpha. */
function blend(base: ImageLike, layer: ImageLike, alpha: Uint8ClampedArray): void {
  const a = base.data, b = layer.data
  for (let p = 0, i = 0; p < alpha.length; p++, i += 4) {
    const t = alpha[p] / 255
    if (t === 0) continue
    a[i] += (b[i] - a[i]) * t
    a[i + 1] += (b[i + 1] - a[i + 1]) * t
    a[i + 2] += (b[i + 2] - a[i + 2]) * t
  }
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

/**
 * Where the source lands on the canvas, as a pure function so the geometry is
 * testable without a real canvas.
 *
 * The canvas is the *oriented* crop window: rotate 90/270 swaps the source's
 * dimensions, and the crop is a fraction of that oriented rect. The source is
 * always drawn at its natural size centred on the origin — the rotation and the
 * swapped canvas size do the work between them. Scaling the draw rect to the
 * oriented size instead (the original approach) squashes any non-square image
 * and leaves it overflowing the canvas on two sides.
 *
 * `tx/ty` are applied in canvas space *before* the rotation, which is what keeps
 * the crop window axis-aligned with the canvas.
 */
export function placement(sw: number, sh: number, state: EditState) {
  const swap = state.rotate === 90 || state.rotate === 270
  const ow = swap ? sh : sw
  const oh = swap ? sw : sh
  const c = state.crop
  return {
    cw: Math.max(1, Math.round((c ? c.w : 1) * ow)),
    ch: Math.max(1, Math.round((c ? c.h : 1) * oh)),
    // Shift the crop window's centre onto the canvas centre.
    tx: c ? -(c.x + c.w / 2 - 0.5) * ow : 0,
    ty: c ? -(c.y + c.h / 2 - 0.5) * oh : 0,
    angle: ((state.rotate + state.straighten) * Math.PI) / 180,
    sx: state.flipH ? -1 : 1,
    sy: state.flipV ? -1 : 1,
  }
}

// Applies geometry (rotate/flip/straighten/crop) into `canvas`, then runs applyEdit on the pixels.
export function renderToCanvas(
  source: ImageBitmap | HTMLImageElement,
  state: EditState,
  canvas: HTMLCanvasElement,
): void {
  const sw = source.width, sh = source.height
  const p = placement(sw, sh, state)
  canvas.width = p.cw
  canvas.height = p.ch
  const ctx = canvas.getContext('2d')!
  ctx.save()
  ctx.translate(p.cw / 2 + p.tx, p.ch / 2 + p.ty)
  ctx.rotate(p.angle)
  ctx.scale(p.sx, p.sy)
  ctx.drawImage(source, -sw / 2, -sh / 2, sw, sh)
  ctx.restore()
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height)
  applyEdit({ data: id.data, width: id.width, height: id.height }, state)
  ctx.putImageData(id, 0, 0)
}
