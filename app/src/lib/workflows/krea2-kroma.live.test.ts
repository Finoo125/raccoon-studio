/**
 * Live Krea2 + Kroma render against a running ComfyUI.
 *
 * Skipped unless `LIVE_RENDER=1`, because it needs the real stack (ComfyUI,
 * the 13 GB Krea2 Turbo checkpoint and the 1.9 GB Kroma LoRA) and takes
 * minutes. Everything else in the suite stays offline and fast.
 *
 *   cd app
 *   LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/krea2-kroma.live.test.ts
 *
 * It answers the only question that matters about a new LoRA: **did ComfyUI
 * actually apply it?** A LoRA whose keys don't map loads without error, patches
 * nothing, and renders a picture that looks perfectly fine — it just isn't the
 * model you asked for. So this renders the same seed twice, once without Kroma
 * and once with, and requires the pixels to move.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { krea2TurboWorkflow, KREA2_KROMA_LORA } from './krea2'
import type { ComfyUIPrompt } from '@/types/comfyui'
import type { GenerationParams } from '@/types/workflow'

const LIVE = process.env.LIVE_RENDER === '1'

/**
 * Fresh every run, and logged so a failure can be replayed with
 * `LIVE_SEED=<n>`. A fixed seed makes the graph byte-identical to the last run
 * and ComfyUI's execution cache then serves it, sampling nothing — a smoke test
 * a broken model would still pass. Both legs share this run's seed, which is
 * what makes the A/B a controlled comparison.
 */
const SEED = Number(process.env.LIVE_SEED ?? Date.now() % 9_000_000_000)

const PROMPT = 'candid portrait photograph of a woman on a balcony at golden hour, natural skin texture, 50mm, shallow depth of field'

const RENDER_TIMEOUT_MS = 15 * 60_000
const POLL_MS = 2_000

/** `.env.local` is what the app reads; vitest does not load it for us. */
function readEnvLocal(): Record<string, string> {
  const file = path.resolve(__dirname, '../../../.env.local')
  const out: Record<string, string> = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^﻿?([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

/**
 * Decode an image to raw RGB at a fixed width via ffmpeg — no image library,
 * same trick the Director live test uses on video frames. Both renders come
 * back at identical dimensions, so the buffers line up index for index.
 */
function rgbPixels(file: string, width = 256): Buffer {
  return execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-vf', `scale=${width}:-2`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 64 * 1024 * 1024 },
  ) as unknown as Buffer
}

/** Mean absolute per-channel difference, 0-255. 0 = the same picture. */
function meanAbsDiff(a: Buffer, b: Buffer): number {
  expect(a.length, 'both renders decode to the same pixel count').toBe(b.length)
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

/**
 * Mean RGB channel spread — the objective DynamicVRAM-corruption metric: ~32-48
 * on a clean colour render, ~90-113 when a resident fp8_scaled model has been
 * corrupted into tiled rainbow garbage. Krea2 Turbo is fp8_scaled, so it is
 * exactly the model that can hit this.
 */
function channelSpread(rgb: Buffer): number {
  let spread = 0
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    spread += Math.max(rgb[i], rgb[i + 1], rgb[i + 2]) - Math.min(rgb[i], rgb[i + 1], rgb[i + 2])
  }
  return spread / (rgb.length / 3)
}

describe.skipIf(!LIVE)('Krea2 + Kroma — live render', () => {
  const env = { ...readEnvLocal(), ...process.env }
  const base = (env.COMFYUI_BASE_URL || 'http://127.0.0.1:8188').replace(/\/$/, '')
  const outputDir = env.COMFYUI_OUTPUT_DIR ?? ''

  /** Baseline params: no post-processing, so the sampler output is what we compare. */
  const params: GenerationParams = {
    prompt: PROMPT,
    width: 832,
    height: 1216,
    seed: SEED,
    upscale: false,
    detailer: false,
    promptEnhancer: false,
  }

  /**
   * Film grain is unseeded noise, so it would differ between two otherwise
   * identical renders and blunt the whole comparison. Dropping it makes the
   * Kroma patch the *only* difference between the two graphs — any movement in
   * the pixels is then attributable to the LoRA and nothing else.
   */
  function withoutGrain(wf: ComfyUIPrompt): ComfyUIPrompt {
    if (wf['grain:film']) {
      wf['k:save'].inputs.images = wf['grain:film'].inputs.image
      delete wf['grain:film']
    }
    return wf
  }

  async function render(label: string, wf: ComfyUIPrompt): Promise<string> {
    const res = await fetch(`${base}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: wf, client_id: 'raccoon-kroma-live' }),
    })
    const body = await res.text()
    expect(res.ok, `[${label}] POST /prompt rejected the graph: ${body}`).toBe(true)
    const { prompt_id } = JSON.parse(body) as { prompt_id: string }
    console.log(`  [${label}] queued ${prompt_id}`)

    const started = Date.now()
    let entry:
      | {
          status?: { completed?: boolean; status_str?: string; messages?: unknown[] }
          outputs?: Record<string, { images?: { filename: string; subfolder: string }[] }>
        }
      | undefined
    while (Date.now() - started < RENDER_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS))
      const hist = await fetch(`${base}/history/${prompt_id}`).then((r) => r.json()).catch(() => ({}))
      entry = (hist as Record<string, typeof entry>)[prompt_id]
      if (entry?.status?.completed !== undefined || entry?.status?.status_str === 'error') break
    }
    const secs = ((Date.now() - started) / 1000).toFixed(0)
    expect(entry, `[${label}] no /history entry after ${secs}s — the job never finished`).toBeTruthy()
    expect(
      entry!.status?.status_str,
      `[${label}] render failed: ${JSON.stringify(entry!.status?.messages)?.slice(0, 1200)}`,
    ).toBe('success')

    const images = Object.values(entry!.outputs ?? {}).flatMap((o) => o.images ?? [])
    expect(images.length, `[${label}] history reports an output image`).toBeGreaterThan(0)
    const onDisk = path.join(outputDir, images[0].subfolder, images[0].filename)
    expect(fs.existsSync(onDisk), `[${label}] output missing on disk: ${onDisk}`).toBe(true)
    console.log(`  [${label}] ${images[0].filename} in ${secs}s`)
    return onDisk
  }

  beforeAll(async () => {
    const stats = await fetch(`${base}/system_stats`).catch(() => null)
    if (!stats?.ok) throw new Error(`ComfyUI is not answering on ${base} — start it first`)
    expect(fs.existsSync(outputDir)).toBe(true)
  }, 60_000)

  it('ComfyUI lists the Kroma LoRA', async () => {
    // Same gate the Generate form uses: a name ComfyUI does not report is
    // rejected at validation with value_not_in_list, so the form never sends it.
    const info = (await (await fetch(`${base}/object_info/LoraLoader`)).json()) as {
      LoraLoader?: { input?: { required?: { lora_name?: [string[]] } } }
    }
    const names = info.LoraLoader?.input?.required?.lora_name?.[0] ?? []
    const found = names.some(
      (n) => n === KREA2_KROMA_LORA || n.replace(/\\/g, '/').endsWith('/' + KREA2_KROMA_LORA),
    )
    expect(found, `${KREA2_KROMA_LORA} is not in ComfyUI's LoRA list — download it first`).toBe(true)
  })

  it('builds a model-only Kroma patch upstream of the user LoRA stack', () => {
    const wf = krea2TurboWorkflow.buildPrompt({ ...params, krea2KromaLora: KREA2_KROMA_LORA })
    expect(wf['krea2:builtin:0'].class_type).toBe('LoraLoaderModelOnly')
    expect(wf['krea2:builtin:0'].inputs.lora_name).toBe(KREA2_KROMA_LORA)
    expect(wf['krea2:builtin:0'].inputs.strength_model).toBe(1)
    expect(wf['krea2:builtin:0'].inputs.model).toEqual(['k:unet', 0])
    expect(wf['k:loras'].inputs.model).toEqual(['krea2:builtin:0', 0])
  })

  it(
    'renders with Kroma and the LoRA measurably changes the image',
    async () => {
      console.log(`  seed ${SEED} (replay with LIVE_SEED=${SEED})`)

      // Unload first: a model left resident from an earlier job makes the first
      // comparison run against a differently-warmed cache, and the exec cache
      // would happily serve a stale result for an identical graph.
      await fetch(`${base}/free`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
      }).catch(() => null)

      const plain = await render('baseline', withoutGrain(krea2TurboWorkflow.buildPrompt(params)))
      const kroma = await render(
        'kroma',
        withoutGrain(krea2TurboWorkflow.buildPrompt({ ...params, krea2KromaLora: KREA2_KROMA_LORA })),
      )

      const a = rgbPixels(plain)
      const b = rgbPixels(kroma)
      const diff = meanAbsDiff(a, b)
      console.log(`  mean abs pixel diff ${diff.toFixed(2)}/255 (0 = the LoRA did nothing)`)
      // The two graphs differ only by the Kroma patch, so an unmapped LoRA would
      // land at ~0. A full fine-tune at strength 1 moves the image a long way.
      expect(diff, 'Kroma did not change the render — its keys did not map onto the model').toBeGreaterThan(2)

      const spread = channelSpread(b)
      console.log(`  mean channel spread ${spread.toFixed(1)} (clean ~32-48, corrupted ~90-113)`)
      expect(spread, `channel spread ${spread.toFixed(1)} is in DynamicVRAM-corruption territory`)
        .toBeLessThan(60)
    },
    RENDER_TIMEOUT_MS + 60_000,
  )
})
