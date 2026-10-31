/**
 * Live Prompt Helper check against a running ComfyUI: the built-in writer turns
 * an idea into a prompt, and Krea2 Turbo renders it into a real picture.
 *
 *   cd app
 *   LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/prompt-builder/prompt-helper.live.test.ts
 *
 * Needs Krea2 Turbo + its text encoder. The render is measured and deleted —
 * nothing is left in the gallery.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { channelSpread, freshSeed, liveEnv, meanLuma, renderGraph, rgb, structure } from '@/lib/workflows/live-render'
import { krea2TurboWorkflow } from '@/lib/workflows/krea2'
import { cleanModelText } from '@/lib/prompts/clean-model-text'
import type { GenerationParams } from '@/types/workflow'
import { buildMessages } from './enhance'
import { promptStyleOf } from './picks'

const LIVE = process.env.LIVE_RENDER === '1'

describe.skipIf(!LIVE)('Prompt Helper — live', () => {
  const env = liveEnv()

  it('writes a clean prompt and Krea2 renders it', async () => {
    // client.ts reads the ComfyUI address when it loads — set it first (localhost, not 127.0.0.1).
    process.env.COMFYUI_BASE_URL = env.base
    const { runBuiltinWriter } = await import('./writer')
    const style = promptStyleOf(krea2TurboWorkflow)
    const prompt = cleanModelText(await runBuiltinWriter(buildMessages('write', style, '', 'a lighthouse keeper on a stormy night')))
    console.log('[helper] prompt:', prompt)
    expect(prompt.length).toBeGreaterThan(80)
    expect(prompt).not.toMatch(/<think>|step \d|score_9|masterpiece|\badult\b/i)

    const seed = freshSeed()
    console.log('[helper] seed', seed)
    const params = { ...krea2TurboWorkflow.defaultParams, prompt, seed, width: 832, height: 1216,
      upscale: false, detailer: false, promptEnhancer: false } as GenerationParams
    const wf = krea2TurboWorkflow.buildPrompt(params)
    wf['k:save'].inputs.filename_prefix = 'prompt-helper-live'
    const { files, seconds } = await renderGraph(env.base, wf, 'prompt-helper', env.outputDir)
    expect(files).toHaveLength(1)
    try {
      const px = rgb(files[0])
      const luma = meanLuma(px)
      const spread = channelSpread(px)
      const shape = structure(files[0])
      console.log(`[helper] ${seconds.toFixed(1)} s, luma ${luma.toFixed(1)}, spread ${spread.toFixed(1)}, structure ${shape.toFixed(1)}`)
      expect(luma, 'not a black frame (~2.5)').toBeGreaterThan(20)
      expect(spread, 'not DynamicVRAM rainbow (90+)').toBeLessThan(60)
      expect(shape, 'not grey texture (0-16)').toBeGreaterThan(16)
    } finally {
      fs.rmSync(files[0], { force: true })
    }
  }, 15 * 60_000)
})
