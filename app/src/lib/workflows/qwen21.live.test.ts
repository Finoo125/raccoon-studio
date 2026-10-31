/**
 * LIVE — Qwen-Image 2.1 end to end, both presets, through the production
 * builder (the registry's wrapped copy, so Expert/tiled-VAE wrapping is real).
 *
 *   cd app
 *   LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/qwen21.live.test.ts
 *
 * Every render is scored: mean luma (black-frame check), channel spread
 * (rainbow corruption) and large-scale structure (the grey texture the Qwen
 * prefix cache produced, which passes the other two). Outputs stay in ComfyUI's
 * output folder for the eye.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { workflows } from './index'
import { QWEN21_PE_T2I, QWEN21_BFS_PROMPT, QWEN21_SHEET_PROMPT } from './qwen21'
import { liveEnv, renderGraph, rgb, meanLuma, channelSpread, structure, freshSeed } from './live-render'
import type { GenerationParams } from '@/types/workflow'

const LIVE = process.env.LIVE_RENDER === '1'
const FACE = process.env.LIVE_FACE ?? 'swap-live-face.png'
const PROMPT = 'photograph of a muscular female bodybuilder flexing her biceps in a gritty gym, chalk dust, harsh overhead light, sweat on defined deltoids and abs, 50mm'

describe.skipIf(!LIVE)('Qwen-Image 2.1 — live', () => {
  const { base, outputDir, inputDir } = liveEnv()
  const seed = freshSeed()
  const preset = (id: string) => workflows.find((w) => w.id === id)!
  const p = (over: Partial<GenerationParams>): GenerationParams =>
    ({ prompt: PROMPT, width: 832, height: 1216, seed, upscale: false, detailer: false, ...over } as GenerationParams)
  /** Copy a render into ComfyUI's input dir so a LoadImage can read it. */
  const toInput = (file: string) => {
    const name = path.basename(file)
    fs.copyFileSync(file, path.join(inputDir, name))
    return name
  }

  async function check(label: string, id: string, params: GenerationParams) {
    const { files, seconds } = await renderGraph(base, preset(id).buildPrompt(params), label, outputDir)
    expect(files.length, `${label}: no image saved`).toBeGreaterThan(0)
    const px = rgb(files[0])
    const luma = meanLuma(px), spread = channelSpread(px), shape = structure(files[0])
    console.log(`  ${label}: ${seconds.toFixed(1)}s luma ${luma.toFixed(1)} spread ${spread.toFixed(1)} structure ${shape.toFixed(1)}  ${files[0]}`)
    expect(luma, `${label} is a black frame`).toBeGreaterThan(10)
    expect(spread, `${label} reads as corrupted`).toBeLessThan(60)
    expect(shape, `${label} has no picture in it (grey texture)`).toBeGreaterThan(20)
    return files[0]
  }

  beforeAll(async () => {
    console.log(`seed ${seed}`)
    const ok = await fetch(`${base}/system_stats`).then((r) => r.ok).catch(() => false)
    if (!ok) throw new Error(`ComfyUI is not answering on ${base}`)
  })

  for (const id of ['qwen21-turbo', 'qwen21']) {
    it(`${id}: text-to-image`, () => check(`${id}/t2i`, id, p({})), 20 * 60_000)
    it(`${id}: HiRes fix + detailer`, () => check(`${id}/hires+det`, id, p({ upscale: true, detailer: true })), 20 * 60_000)
    it(`${id}: ControlNet (depth)`, async () => {
      // A fresh render is the reference; depth keeps its pose on a new seed.
      const ref = toInput(await check(`${id}/cn-ref`, id, p({ seed: seed + 7 })))
      await check(`${id}/controlnet`, id, p({ controlNet: { mode: 'depth', image: ref, strength: 0.7 } }))
    }, 30 * 60_000)
    it(`${id}: img2img`, async () => {
      const src = toInput(await check(`${id}/i2i-src`, id, p({ seed: seed + 11 })))
      await check(`${id}/img2img`, id, p({ baseImage: src, editMode: 'img2img', denoise: 0.55 }))
    }, 30 * 60_000)
  }

  it('turbo: enhancer on', () =>
    check('turbo/enhancer', 'qwen21-turbo', p({ promptEnhancer: true, qwen21Enhancer: QWEN21_PE_T2I })), 20 * 60_000)

  it('turbo: face swap, then a plain render must not come back black', async () => {
    // Krea2 returned black frames for every render after the first swap of a
    // session (krea2.ts). Qwen gets the same probe: swap, then plain t2i.
    await check('turbo/swap', 'qwen21-turbo', p({ faceSwap: true, inputImage: FACE }))
    await check('turbo/after-swap', 'qwen21-turbo', p({ seed: seed + 3 }))
    await check('turbo/after-swap-2', 'qwen21-turbo', p({ seed: seed + 4 }))
  }, 30 * 60_000)

  it('edit: a plain edit, a head swap and a character sheet', async () => {
    // Picture 1 from the Turbo; picture 2 for BFS is the swap suite's face photo.
    const person = toInput(await check('edit/src', 'qwen21-turbo', p({ seed: seed + 21 })))
    await check('edit/plain', 'qwen21-edit', p({
      prompt: 'change the background to a sunny beach at noon, keep the woman, her pose and her clothes unchanged',
      qwenReferences: [person],
    }))
    await check('edit/bfs', 'qwen21-edit', p({ prompt: QWEN21_BFS_PROMPT, qwenReferences: [person, FACE], editChip: 'bfs' }))
    await check('edit/sheet', 'qwen21-edit', p({ prompt: QWEN21_SHEET_PROMPT, qwenReferences: [person], editChip: 'sheet' }))
  }, 40 * 60_000)

  it('base: a LoRA attaches patches', async () => {
    // BFS head v1.1 is on disk for Task 13 and is a real Qwen 2.1 LoRA. The
    // render must still be healthy; `grep "patches attached"` in ComfyUI's
    // log (/internal/logs/raw) must show a non-zero count for it.
    await check('base/lora', 'qwen21', p({ loras: [{ name: 'bfs_head_v1.1_qwen_2.1.safetensors', strength: 0.5 }] }))
  }, 20 * 60_000)
})
