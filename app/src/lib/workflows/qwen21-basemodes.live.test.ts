/**
 * LIVE — Qwen-Image 2.1 Turbo in the base-image modes (img2img, inpaint,
 * outpaint) through the production builder, with the 40-step base beside it.
 *
 *   cd app
 *   LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/qwen21-basemodes.live.test.ts --reporter=verbose
 *
 * Why it exists (2026-10-02, two seeds): the Turbo's base-image modes used to
 * fall back to a KSampler at 6 steps, and that over-cooked every one —
 * img2img p99 detail 178 against 119 on Viggle's schedule cut by
 * SplitSigmasDenoise (base 132, source 87), inpaint 133-152 against 104-127
 * with crusted skin and the edit ignored. The cut is what ships now. Outpaint
 * looked the same either way: every family, the base and Z-Image included,
 * hands the blurred content seed back in the new strips (img2img.ts).
 *
 * Writes one sheet per mode next to the renders (columns in the logged order).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { workflows } from './index'
import { liveEnv, renderGraph, structure, freshSeed, laplacianP99 } from './live-render'
import type { ComfyUIPrompt } from '@/types/comfyui'
import type { GenerationParams } from '@/types/workflow'

const LIVE = process.env.LIVE_RENDER === '1'
const PROMPT = 'photograph of a muscular female bodybuilder flexing her biceps in a gritty gym, chalk dust, harsh overhead light, sweat on defined deltoids and abs, 50mm'
const INPAINT_PROMPT = PROMPT.replace('flexing', 'wearing a bright red tank top, flexing')
const PAD = 192

describe.skipIf(!LIVE)('Qwen-Image 2.1 Turbo — base-image modes', () => {
  const { base, outputDir, inputDir } = liveEnv()
  const seed = freshSeed()
  const preset = (id: string) => workflows.find((w) => w.id === id)!
  const p = (over: Partial<GenerationParams>): GenerationParams =>
    ({ prompt: PROMPT, width: 832, height: 1216, seed, upscale: false, detailer: false, ...over } as GenerationParams)

  async function render(label: string, wf: ComfyUIPrompt) {
    const { files, seconds } = await renderGraph(base, wf, label, outputDir)
    expect(files.length, `${label}: no image saved`).toBeGreaterThan(0)
    const shape = structure(files[0])
    console.log(`  ${label}: ${seconds.toFixed(1)}s structure ${shape.toFixed(1)} p99 ${laplacianP99(files[0]).toFixed(1)}  ${files[0]}`)
    expect(shape, `${label} has no picture in it (grey texture)`).toBeGreaterThan(20)
    return files[0]
  }

  /** Side-by-side at a common height, columns in the order given (logged). */
  function sheet(name: string, items: [string, string][]) {
    const out = path.join(outputDir, `qwen21-basemodes-${name}-${seed}.png`)
    const graph = items.map((_, i) => `[${i}]scale=-2:768[v${i}]`).join(';') +
      `;${items.map((_, i) => `[v${i}]`).join('')}hstack=inputs=${items.length}`
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...items.flatMap(([, f]) => ['-i', f]), '-filter_complex', graph, out])
    console.log(`  sheet (${items.map(([l]) => l).join(' | ')}): ${out}`)
  }

  beforeAll(async () => {
    console.log(`seed ${seed}`)
    const ok = await fetch(`${base}/system_stats`).then((r) => r.ok).catch(() => false)
    if (!ok) throw new Error(`ComfyUI is not answering on ${base}`)
  })

  it('inpaint, img2img and outpaint: turbo vs base', async () => {
    const turbo = preset('qwen21-turbo'), full = preset('qwen21')
    const srcFile = await render('src', turbo.buildPrompt(p({})))
    const src = `qwen21-bm-src-${seed}.png`
    fs.copyFileSync(srcFile, path.join(inputDir, src))
    // Torso box: the tank top goes here.
    const mask = `qwen21-bm-mask-${seed}.png`
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=black:s=832x1216',
      '-vf', 'drawbox=x=176:y=420:w=480:h=520:color=white:t=fill', '-frames:v', '1', path.join(inputDir, mask)])

    const inpaint = p({ prompt: INPAINT_PROMPT, baseImage: src, editMode: 'inpaint', maskImage: mask, denoise: 0.65 })
    const outpaint = p({ baseImage: src, editMode: 'outpaint', outpaint: { left: PAD, top: 0, right: PAD, bottom: 0, feather: 24 } })

    sheet('inpaint', [
      ['source', srcFile],
      ['turbo', await render('inpaint/turbo', turbo.buildPrompt(inpaint))],
      ['base 40', await render('inpaint/base', full.buildPrompt(inpaint))],
    ])
    const i2i = p({ baseImage: src, editMode: 'img2img', denoise: 0.55 })
    sheet('img2img', [
      ['source', srcFile],
      ['turbo', await render('img2img/turbo', turbo.buildPrompt(i2i))],
      ['base 40', await render('img2img/base', full.buildPrompt(i2i))],
    ])
    sheet('outpaint', [
      ['turbo', await render('outpaint/turbo', turbo.buildPrompt(outpaint))],
      ['base 40', await render('outpaint/base', full.buildPrompt(outpaint))],
    ])
  }, 40 * 60_000)
})
