/**
 * `--enable-triton-backend` A/B — does comfy-kitchen's Triton INT8 backend beat
 * the eager fallback we are stuck on under cu128, and does it cost quality?
 *
 *   # with ComfyUI launched WITHOUT the flag
 *   TRITON_TAG=off LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/h3-triton-backend.live.test.ts
 *   # restart ComfyUI WITH --enable-triton-backend, then
 *   TRITON_TAG=on  LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/h3-triton-backend.live.test.ts
 *   # then
 *   python <scratchpad>/h3_triton_report.py <scratchpad>/h3-triton-full
 *
 * The flag is **process-global**, not H3-specific: it swaps the backend for every
 * comfy-kitchen quant op, so anything with quantized weights is in scope. Read
 * off the safetensors headers rather than assumed (2026-08-30):
 *
 *   quantized, therefore tested   H3 (I8+U8, 200 scales), Krea2 Turbo and
 *                                 LTX 2.3 10Eros (both F8_E4M3 + scales)
 *   BF16/F16, therefore skipped   Z-Image, Anima, Illustrious — they never
 *                                 reach a quant op, so the flag cannot touch them
 *
 * Krea2 gets three runs where H3 gets one per seed, because Krea2 Turbo is the
 * one fp8_scaled model we ship and DynamicVRAM corrupts those *non
 * deterministically* — 5 of 8 in the 2026-07-28 measurement. One clean Krea2
 * render proves nothing; the run-to-run spread is the signal. Scored with the
 * same channel-spread metric the Kroma test uses.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import { minimaxH3Workflow } from './minimax-h3'
import { krea2TurboWorkflow } from './krea2'
import { ltx23Workflow } from './ltx23'
import type { ComfyUIPrompt } from '@/types/comfyui'

const LIVE = process.env.LIVE_RENDER === '1'
const COMFY = process.env.COMFYUI_URL ?? 'http://localhost:8188'
const TAG = process.env.TRITON_TAG ?? 'unset'
const OUT =
  process.env.TRITON_AB_DIR ??
  path.join(os.tmpdir(), 'raccoon-h3-triton-full')
const TIMEOUT = 40 * 60_000

/** Two seeds beyond the 707707 already measured, so flicker/SNR get n=3. */
const H3_SEEDS = [313131, 858585]
const KREA2_RUNS = 3

const H3_BRIEF =
  'integrated_multimodal_description: [Shot 1] At 00:00.000 A woman in her thirties in a ' +
  'weathered leather jacket walks steadily along a rain-wet city street at night, neon signs ' +
  'reflecting in the puddles behind her. The camera tracks backwards ahead of her at a slow ' +
  'even speed, holding her in a medium shot. <d>Every single one of these streets looks the ' +
  'same after midnight.</d> She glances over her shoulder, then keeps walking.\n' +
  'overall_soundscape: Clear close speech over wet footsteps on pavement, distant traffic and ' +
  'a faint hum of neon. Light rain throughout.\n' +
  'non_diegetic_music: N/A'

const KREA2_PROMPT =
  'a weathered fisherman mending a net on a stone harbour wall at golden hour, ' +
  'deep skin texture, salt-crusted wool, shallow depth of field'

async function free() {
  await fetch(`${COMFY}/free`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  }).catch(() => {})
}

async function render(label: string, wf: ComfyUIPrompt, ext: string): Promise<number> {
  await free()
  const started = Date.now()
  const r = await fetch(`${COMFY}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: wf, client_id: 'raccoon-triton-ab' }),
  })
  const body = await r.json()
  expect(r.status, `${label}: ${JSON.stringify(body).slice(0, 700)}`).toBe(200)

  const deadline = Date.now() + TIMEOUT
  let outs: { filename: string; subfolder: string }[] = []
  for (;;) {
    if (Date.now() > deadline) throw new Error(`${label} timed out`)
    await new Promise((x) => setTimeout(x, 2500))
    const h = await (await fetch(`${COMFY}/history/${body.prompt_id}`)).json()
    const e = h?.[body.prompt_id]
    if (e?.status?.status_str === 'error') throw new Error(`${label}: ${JSON.stringify(e.status).slice(0, 700)}`)
    if (e?.status?.completed) {
      outs = Object.values(e.outputs ?? {}).flatMap((o) =>
        Object.values(o as Record<string, unknown[]>).flat()) as typeof outs
      break
    }
  }
  const secs = (Date.now() - started) / 1000
  const file = outs.find((o) => o.filename?.endsWith(ext))
  expect(file, `${label}: no ${ext} in ${JSON.stringify(outs)}`).toBeTruthy()
  const url = `${COMFY}/view?filename=${encodeURIComponent(file!.filename)}&subfolder=${encodeURIComponent(file!.subfolder ?? '')}&type=output`
  fs.writeFileSync(path.join(OUT, `${TAG}-${label}${ext}`), Buffer.from(await (await fetch(url)).arrayBuffer()))
  fs.appendFileSync(path.join(OUT, 'times.txt'), `${TAG} ${label}: ${secs.toFixed(1)}s\n`)
  console.log(`[triton-ab] ${TAG} ${label}: ${secs.toFixed(1)}s`)
  return secs
}

/** Drop the unseeded film-grain pass — it would differ between runs and blunt the diff. */
function withoutGrain(wf: ComfyUIPrompt): ComfyUIPrompt {
  if (wf['grain:film']) {
    wf['k:save'].inputs.images = wf['grain:film'].inputs.image
    delete wf['grain:film']
  }
  return wf
}

describe.skipIf(!LIVE)(`triton backend A/B [${TAG}]`, () => {
  beforeAll(async () => {
    expect(['on', 'off'], 'set TRITON_TAG=on or TRITON_TAG=off').toContain(TAG)
    const s = await (await fetch(`${COMFY}/system_stats`)).json()
    const on = (s?.system?.argv ?? []).includes('--enable-triton-backend')
    // The whole experiment is worthless if the halves are mislabelled, and a
    // mislabelled half looks exactly like a null result.
    expect(on, `TRITON_TAG=${TAG} but ComfyUI argv says flag=${on}`).toBe(TAG === 'on')
    fs.mkdirSync(OUT, { recursive: true })
  })

  it('H3 — two fresh seeds', async () => {
    for (const seed of H3_SEEDS) {
      await render(
        `h3-${seed}`,
        minimaxH3Workflow.buildPrompt({
          prompt: H3_BRIEF, mode: 't2v', orientation: 'landscape', durationSeconds: 5,
          fps: 24, seed, vramMode: 'low', turbo: 'fast',
        } as never) as ComfyUIPrompt,
        '.mp4',
      )
    }
  }, TIMEOUT)

  it('Krea2 Turbo — fp8_scaled, three runs for the corruption spread', async () => {
    for (let i = 0; i < KREA2_RUNS; i++) {
      await render(
        `krea2-${i}`,
        withoutGrain(krea2TurboWorkflow.buildPrompt({
          prompt: KREA2_PROMPT, width: 832, height: 1216, seed: 4242 + i,
          upscale: false, detailer: false, promptEnhancer: false,
        } as never)),
        '.png',
      )
    }
  }, TIMEOUT)

  it('LTX 2.3 — the other fp8_scaled model', async () => {
    await render(
      'ltx',
      ltx23Workflow.buildPrompt({
        prompt: 'a lone lighthouse on a rocky headland at dawn, slow push in, gulls overhead',
        mode: 't2v', orientation: 'landscape', durationSeconds: 3, fps: 24,
        seed: 707707, vramMode: 'low',
      } as never) as ComfyUIPrompt,
      '.mp4',
    )
  }, TIMEOUT)
})
