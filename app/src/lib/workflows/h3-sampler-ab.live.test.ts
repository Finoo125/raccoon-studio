/**
 * H3 sampler/scheduler A/B — is PlagueKind's `seeds_2` + `sgm_uniform` better
 * than our `res_multistep` + `simple`?
 *
 *   cd app
 *   LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/h3-sampler-ab.live.test.ts
 *
 * Renders one brief at a fixed seed through four sampler configs and writes the
 * clips to a scratchpad dir; `h3_sampler_ab.py` then measures them.
 *
 * **The legs are NFE-matched, not step-matched.** `seeds_2` is a second-order
 * solver: two model evaluations per step, so 4 of its steps cost about what 8
 * of `res_multistep`'s do. Comparing "his 4" against "our 8" at equal *steps*
 * would read as a 2x speedup that is really just half the work, and comparing
 * at equal steps the other way would read as a quality win that is really just
 * double the work. Hence `seeds2-8` as well: the ceiling, at 2x the price.
 *
 * `sgm-only` is the leg that makes the result actionable. Without it a win is
 * unattributable — scheduler and sampler changed together — and the scheduler
 * alone is a one-word diff we could take without touching the sampler.
 *
 * Deliberate controls:
 *  - **the Fast tier, not plain 20-step.** The sampler has to live with our
 *    distillation LoRA, which was distilled against a schedule none of these
 *    were tuned on. Measuring it without one measures a config nobody renders.
 *  - **fixed seed across legs.** The sampler legitimately changes the latent
 *    trajectory; everything upstream of it must not.
 *  - **`POST /free` between renders** — back-to-back H3 renders have taken this
 *    ComfyUI down with a driver fault, and a half-measured A/B is worse than
 *    none.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import { minimaxH3Workflow, H3_TURBO } from './minimax-h3'
import { MINIMAX_H3_ASSETS } from '@/lib/models/minimax-h3-assets'
import type { VideoGenerationParams } from '@/types/video-workflow'
import type { ComfyUIPromptNode } from '@/types/comfyui'

const LIVE = process.env.LIVE_RENDER === '1'
const COMFY = process.env.COMFYUI_URL ?? 'http://localhost:8188'
const OUT_DIR =
  process.env.H3_SAMPLER_AB_DIR ??
  path.join(os.tmpdir(), 'raccoon-h3-sampler-ab')

/** Same seed on every leg, or the comparison measures the seed. */
const SEED = Number(process.env.LIVE_SEED ?? 707707)
const RENDER_TIMEOUT_MS = 30 * 60_000

/**
 * One brief carrying all three things a sampler can damage: speech (HF detail
 * and sibilance), continuous camera motion (temporal stability), and a face in
 * good light (fine detail). A brief that only tests one of them would let a
 * sampler that trades two for the third look like a clean win.
 */
const BRIEF =
  'integrated_multimodal_description: [Shot 1] At 00:00.000 A woman in her thirties in a ' +
  'weathered leather jacket walks steadily along a rain-wet city street at night, neon signs ' +
  'reflecting in the puddles behind her. The camera tracks backwards ahead of her at a slow ' +
  'even speed, holding her in a medium shot. <d>Every single one of these streets looks the ' +
  'same after midnight.</d> She glances over her shoulder, then keeps walking.\n' +
  'overall_soundscape: Clear close speech over wet footsteps on pavement, distant traffic and ' +
  'a faint hum of neon. Light rain throughout.\n' +
  'non_diegetic_music: N/A'

/** `sampler`/`scheduler`/`steps` overrides patched onto the built graph. */
const LEGS: { id: string; sampler: string; scheduler: string; steps: number }[] = [
  // Ours today.
  { id: 'control', sampler: 'res_multistep', scheduler: 'simple', steps: H3_TURBO.fast.steps },
  // His V7 recommendation, NFE-matched against the control.
  { id: 'seeds2', sampler: 'seeds_2', scheduler: 'sgm_uniform', steps: 4 },
  // The same at our step count — 2x the control's work, so a win here is only
  // interesting if `seeds2` above lost.
  { id: 'seeds2-8', sampler: 'seeds_2', scheduler: 'sgm_uniform', steps: H3_TURBO.fast.steps },
  // Scheduler alone. If this matches `seeds2`, the sampler was never the point.
  { id: 'sgm-only', sampler: 'res_multistep', scheduler: 'sgm_uniform', steps: H3_TURBO.fast.steps },
]

/** `H3_SAMPLER_ONLY=seeds2,control` renders a subset — for topping up a set. */
const ONLY = process.env.H3_SAMPLER_ONLY?.split(',').map((s) => s.trim()).filter(Boolean)

const params = (): VideoGenerationParams => ({
  prompt: BRIEF,
  mode: 't2v',
  orientation: 'landscape',
  durationSeconds: 5,
  fps: 24,
  seed: SEED,
  vramMode: 'low',
  turbo: 'fast',
})

const nodeOf = (wf: Record<string, ComfyUIPromptNode>, cls: string) =>
  Object.values(wf).find((n) => n.class_type === cls)

async function waitForOutputs(promptId: string): Promise<{ filename: string; subfolder: string }[]> {
  const deadline = Date.now() + RENDER_TIMEOUT_MS
  for (;;) {
    if (Date.now() > deadline) throw new Error(`render timed out after ${RENDER_TIMEOUT_MS}ms`)
    await new Promise((r) => setTimeout(r, 5000))
    const hist = await (await fetch(`${COMFY}/history/${promptId}`)).json()
    const entry = hist?.[promptId]
    if (!entry) continue
    if (entry.status?.status_str === 'error')
      throw new Error(JSON.stringify(entry.status).slice(0, 800))
    if (entry.status?.completed) {
      return Object.values(entry.outputs ?? {}).flatMap((o) =>
        Object.values(o as Record<string, unknown[]>).flat(),
      ) as { filename: string; subfolder: string }[]
    }
  }
}

/** Model filenames ComfyUI currently lists, across the loaders H3 uses. */
async function installedModels(): Promise<Set<string>> {
  const out = new Set<string>()
  for (const [cls, field] of [
    ['UNETLoader', 'unet_name'],
    ['CLIPLoader', 'clip_name'],
    ['VAELoader', 'vae_name'],
    ['LoraLoader', 'lora_name'],
  ] as [string, string][]) {
    const d = await (await fetch(`${COMFY}/object_info/${cls}`)).json().catch(() => null)
    for (const n of d?.[cls]?.input?.required?.[field]?.[0] ?? []) out.add(String(n))
  }
  return out
}

describe.skipIf(!LIVE)('MiniMax H3 sampler A/B', () => {
  beforeAll(async () => {
    const r = await fetch(`${COMFY}/system_stats`).catch(() => null)
    if (!r?.ok) throw new Error(`ComfyUI is not reachable at ${COMFY}`)
  })

  it(
    'renders one brief through each sampler config at a fixed seed',
    async () => {
      fs.mkdirSync(OUT_DIR, { recursive: true })

      const have = await installedModels()
      // The Fast LoRA is load-bearing here, not optional: without it every leg
      // renders at a schedule none of them were chosen for.
      const need = [
        ...MINIMAX_H3_ASSETS.filter((a) => !a.optional).map((a) => a.name),
        H3_TURBO.fast.lora,
      ]
      const absent = need.filter((n) => !have.has(n) && ![...have].some((x) => x.endsWith('/' + n)))
      if (absent.length) {
        console.warn(`[h3-sampler] skipping — not installed: ${absent.join(', ')}`)
        return
      }

      const todo = ONLY ? LEGS.filter((l) => ONLY.includes(l.id)) : LEGS
      expect(todo.length, `H3_SAMPLER_ONLY matched nothing: ${ONLY?.join(',')}`).toBeGreaterThan(0)
      console.log(`[h3-sampler] seed ${SEED} -> ${OUT_DIR}`)

      const timings: Record<string, number> = {}
      for (const leg of todo) {
        await fetch(`${COMFY}/free`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unload_models: true, free_memory: true }),
        }).catch(() => {})

        const wf = minimaxH3Workflow.buildPrompt(params()) as Record<string, ComfyUIPromptNode>
        const sampler = nodeOf(wf, 'KSamplerSelect')!
        const sched = nodeOf(wf, 'BasicScheduler')!
        sampler.inputs.sampler_name = leg.sampler
        sched.inputs.scheduler = leg.scheduler
        sched.inputs.steps = leg.steps

        const started = Date.now()
        const r = await fetch(`${COMFY}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: wf, client_id: 'raccoon-h3-sampler-ab' }),
        })
        const body = await r.json()
        expect(r.status, JSON.stringify(body).slice(0, 800)).toBe(200)

        const outs = await waitForOutputs(body.prompt_id)
        const mp4 = outs.find((o) => o.filename?.endsWith('.mp4'))
        expect(mp4, `no mp4 for ${leg.id}: ${JSON.stringify(outs)}`).toBeTruthy()

        const url = `${COMFY}/view?filename=${encodeURIComponent(mp4!.filename)}&subfolder=${encodeURIComponent(mp4!.subfolder ?? '')}&type=output`
        const bytes = Buffer.from(await (await fetch(url)).arrayBuffer())
        fs.writeFileSync(path.join(OUT_DIR, `${leg.id}.mp4`), bytes)
        timings[leg.id] = (Date.now() - started) / 1000
        console.log(
          `[h3-sampler] ${leg.id} (${leg.sampler}/${leg.scheduler}, ${leg.steps} steps): ` +
            `${timings[leg.id].toFixed(0)}s, ${(bytes.length / 1e6).toFixed(2)} MB`,
        )
      }
      // Wall time is half the verdict and is not recoverable from the mp4s, so
      // it goes on disk beside them rather than only into the scrollback.
      fs.writeFileSync(
        path.join(OUT_DIR, 'timings.json'),
        JSON.stringify({ seed: SEED, legs: LEGS, seconds: timings }, null, 2),
      )
    },
    RENDER_TIMEOUT_MS * LEGS.length,
  )
})
