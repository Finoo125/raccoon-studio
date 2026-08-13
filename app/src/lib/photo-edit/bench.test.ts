import { describe, it } from 'vitest'
import { applyEdit } from './pipeline'
import { defaultEditState, ZERO_ADJUSTMENTS, type EditState, type ImageLike } from './types'

/**
 * Not an assertion — a stopwatch. `BENCH=1 vitest run src/lib/photo-edit/bench.test.ts`
 * prints the per-render cost of each part of the pipeline at preview resolution,
 * which is what decides whether the render can stay on the main thread.
 */
const RUN = process.env.BENCH === '1'

const noise = (w: number, h: number): ImageLike => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let p = 0; p < w * h; p++) {
    data[p * 4] = (p * 37) % 256
    data[p * 4 + 1] = (p * 91) % 256
    data[p * 4 + 2] = (p * 173) % 256
    data[p * 4 + 3] = 255
  }
  return { data, width: w, height: h }
}

describe.runIf(RUN)('pipeline cost at 1600×900', () => {
  const time = (label: string, state: EditState) => {
    const img = noise(1600, 900)
    applyEdit(noise(64, 64), state)          // warm the JIT
    const t = performance.now()
    applyEdit(img, state)
    console.log(`  ${label.padEnd(34)} ${(performance.now() - t).toFixed(1)} ms`)
  }

  it('prints a breakdown', () => {
    const s = () => defaultEditState()

    time('identity', s())

    const tone = s()
    tone.adjustments = { ...ZERO_ADJUSTMENTS, exposure: 20, contrast: 15, highlights: -30, shadows: 25 }
    time('tone sliders (fused point pass)', tone)

    const curve = s()
    curve.curve.rgb = [{ x: 0, y: 0 }, { x: 128, y: 150 }, { x: 255, y: 255 }]
    time('+ tone curve', curve)

    const hsl = s()
    hsl.hsl.blue.sat = -40
    time('+ HSL mixer', hsl)

    const clarity = s()
    clarity.adjustments = { ...ZERO_ADJUSTMENTS, clarity: 40 }
    time('clarity (radius 6 unsharp)', clarity)

    const texture = s()
    texture.adjustments = { ...ZERO_ADJUSTMENTS, texture: 40 }
    time('texture (radius 2 unsharp)', texture)

    const haze = s()
    haze.adjustments = { ...ZERO_ADJUSTMENTS, dehaze: 50 }
    time('dehaze (dark channel prior)', haze)

    const grain = s()
    grain.adjustments = { ...ZERO_ADJUSTMENTS, grain: 40 }
    time('grain', grain)

    const masked = s()
    masked.masks = [{
      id: 'm', kind: 'radial', name: 'M', invert: false, feather: 50,
      radial: { cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3 },
      adjustments: { ...ZERO_ADJUSTMENTS, exposure: 30 },
    }]
    time('+ one radial mask', masked)

    const everything = s()
    everything.adjustments = {
      ...ZERO_ADJUSTMENTS, exposure: 20, contrast: 15, highlights: -30, shadows: 25,
      texture: 20, clarity: 30, dehaze: 25, sharpness: 40, vignette: 20, grain: 15,
    }
    everything.curve.rgb = [{ x: 0, y: 0 }, { x: 128, y: 150 }, { x: 255, y: 255 }]
    everything.hsl.blue.sat = -40
    everything.masks = masked.masks
    time('everything at once', everything)
  })
})
