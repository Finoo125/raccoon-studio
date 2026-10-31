/**
 * LIVE — what Qwen's prompt enhancer actually writes. Krea2's leaked its own
 * reasoning into 17/50 prompts with the wrong `thinking` value, and the picture
 * hid it half the time — so this reads TextGenerate's output 0 as TEXT through
 * PreviewAny, never through an image.
 *
 *   cd app
 *   LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/qwen21-enhancer.live.test.ts
 *
 * 5 prompts × 10 seeds × thinking {false, true}. A leak is any output carrying
 * a think tag, a step header or the system prompt's own vocabulary, or JSON.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { qwen21TurboWorkflow, QWEN21_PE_T2I } from './qwen21'
import { liveEnv, renderGraph, freshSeed } from './live-render'
import type { ComfyUIPrompt } from '@/types/comfyui'

const LIVE = process.env.LIVE_RENDER === '1'
const PROMPTS = [
  'female bodybuilder flexing',
  'muscular woman on a beach at sunset',
  'a powerlifter woman deadlifting in a garage gym, chalk, sweat',
  'portrait of a strong woman with broad shoulders, studio light',
  'female bodybuilder on stage, posing trunks, deep tan, spotlight, with the words "FINALS 2026" on the banner behind her',
]
const LEAK = /<\/?think>|^#|Step \d|wh_ratio|Output format|Image Prompt Rewriting|\{\s*"|^\s*-\s/m
const SEEDS = Number(process.env.PE_SEEDS ?? 10)

describe.skipIf(!LIVE)('Qwen-Image 2.1 — prompt enhancer', () => {
  it('writes one clean paragraph, never its reasoning', async () => {
    const { base, outputDir } = liveEnv()
    const rows: { thinking: boolean; prompt: number; seed: number; chars: number; seconds: number; leak: boolean; text: string }[] = []
    const seed0 = freshSeed()
    for (const thinking of [false, true]) {
      for (const [pi, prompt] of PROMPTS.entries()) {
        for (let s = 0; s < SEEDS; s++) {
          const seed = seed0 + s
          const full = qwen21TurboWorkflow.buildPrompt({
            prompt, width: 832, height: 1216, seed, upscale: false, detailer: false,
            promptEnhancer: true, qwen21Enhancer: QWEN21_PE_T2I,
          })
          // Just the enhancer: loader → TextGenerate → PreviewAny. No image.
          const wf: ComfyUIPrompt = {
            'q:pe': full['q:pe'],
            'q:enhance': { ...full['q:enhance'], inputs: { ...full['q:enhance'].inputs, thinking } },
            'q:show': { class_type: 'PreviewAny', inputs: { source: ['q:enhance', 0] } },
          }
          const { texts, seconds } = await renderGraph(base, wf, `pe/${thinking}/${pi}/${s}`, outputDir)
          const text = texts.join('\n')
          rows.push({ thinking, prompt: pi, seed, chars: text.length, seconds, leak: LEAK.test(text), text })
          console.log(`  thinking=${thinking} p${pi} s${s}: ${text.length} chars ${seconds.toFixed(1)}s${LEAK.test(text) ? ' LEAK' : ''}`)
        }
      }
    }
    const out = path.join(process.env.PE_OUT ?? process.env.TEMP ?? '.', 'qwen21-enhancer.json')
    fs.writeFileSync(out, JSON.stringify(rows, null, 2))
    for (const thinking of [false, true]) {
      const r = rows.filter((x) => x.thinking === thinking)
      const leaks = r.filter((x) => x.leak).length
      const max = Math.max(...r.map((x) => x.chars))
      const secs = r.reduce((a, x) => a + x.seconds, 0) / r.length
      console.log(`thinking=${thinking}: ${leaks}/${r.length} leaked, longest ${max} chars, mean ${secs.toFixed(1)}s  (${out})`)
    }
  }, 3 * 60 * 60_000)
})
