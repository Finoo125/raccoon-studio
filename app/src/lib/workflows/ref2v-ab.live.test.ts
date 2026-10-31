/**
 * Reference mode, stock ref2va vs 10Eros Max beta4 — the render this A/B needed.
 *
 *     LIVE_RENDER=1 REF2V_AB_DIR=<out> node_modules/.bin/vitest run \
 *       src/lib/workflows/ref2v-ab.live.test.ts
 *
 * Two clips, identical in everything but the checkpoint: same seed, same
 * reference image, same prompt, same 8 steps. Untracked like `eros-ab`, and for
 * the same reason — it renders against whatever is on this box.
 *
 * **Why the stock leg runs Turbo.** Eros always renders at 8 steps (its
 * distillation is merged into the weights), so a stock leg at the default 20
 * would be a step-count contest wearing a checkpoint's clothes. `turbo: 'fast'`
 * + `ref2vTurbo` puts stock on ref2va's own 4-step distillation given the same
 * 8 steps. Not a perfect match — no 8-step ref2v distillation exists — but the
 * same order of work, which is the readable comparison available.
 *
 * **One shot, deliberately.** Identity collapses at shot cuts (0.85 / 0.63 /
 * 0.37 across three shots, measured 2026-09-05), which would swamp the thing
 * being compared here: how well each checkpoint holds the reference face.
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import { minimaxH3Workflow, H3_EROS, H3_REF2VA_CKPT, H3_REF2V_TURBO_LORA } from './minimax-h3'
import type { VideoGenerationParams } from '@/types/video-workflow'
import type { ComfyUIPromptNode } from '@/types/comfyui'

const LIVE = process.env.LIVE_RENDER === '1'
const COMFY = process.env.COMFYUI_URL ?? 'http://localhost:8188'
const DIR = process.env.REF2V_AB_DIR
const REF_IMAGE = process.env.REF2V_AB_IMAGE ?? 'annalisa.png'
const SEED = Number(process.env.REF2V_AB_SEED ?? 20260906)
const DURATION_S = Number(process.env.REF2V_AB_SECONDS ?? 5)
const ORIENTATION = (process.env.REF2V_AB_ORIENTATION ??
  'landscape') as VideoGenerationParams['orientation']
const VRAM = (process.env.REF2V_AB_VRAM ?? 'low') as VideoGenerationParams['vramMode']
const RENDER_TIMEOUT_MS = 40 * 60_000

/**
 * The doctrine's own shape for reference mode: the declaration line first (H3's
 * guide makes it load-bearing), then the three Base fields. Hand-written rather
 * than enhanced, so the two legs cannot differ by a word.
 */
const DEFAULT_PROMPT = `For the target video, the attached references are used as follows: <Picture 1> is fully_preserved.

integrated_multimodal_description: [Shot 1] Cinematic live-action footage, shallow depth of field, warm practical lighting from a window to camera left. A young woman with long auburn hair and pale skin, wearing a charcoal blazer over a black tee, sits at a small cafe table by that window, a white cup in front of her. She is turned three-quarters toward the lens. The camera holds a slow, almost imperceptible push-in on her face for the entire clip, no cuts. She lifts her eyes to the lens, the corner of her mouth pulling into a small amused smile, then leans a few inches forward and rests her forearms on the table. Her hair shifts against her shoulder as she moves. Late-afternoon light traces the edge of her cheek and catches the rim of the cup. She holds the look, breathes in, and the woman (S1) says: <d>[English] I was starting to think you would not show up.</d> After the line she tilts her head slightly, still watching the lens, and the smile settles into something quieter and warmer. Background: a softly blurred cafe interior, an out-of-focus figure passing behind her once, shelves and hanging lamps reduced to warm bokeh. The framing stays a medium close-up throughout, the horizon steady, no whip pans and no cutaways.
overall_soundscape: A quiet cafe interior with a low murmur of distant conversation and the occasional soft clink of ceramic. Her voice is close and intimate, recorded as if the microphone were just off camera, with a natural room reflection. A chair scrapes faintly somewhere behind her.
non_diegetic_music: A sparse, warm piano figure under the room tone, brushed and unhurried, sitting well below the dialogue.`

/** `REF2V_AB_PROMPT_FILE` swaps the brief without editing this file. */
const PROMPT = process.env.REF2V_AB_PROMPT_FILE
  ? fs.readFileSync(process.env.REF2V_AB_PROMPT_FILE, 'utf8').trim()
  : DEFAULT_PROMPT

const nodeOf = (wf: Record<string, ComfyUIPromptNode>, cls: string) =>
  Object.values(wf).find((n) => n.class_type === cls)

/** Every LoRA in the MODEL chain, in the order ComfyUI would apply them. */
function loraChain(wf: Record<string, ComfyUIPromptNode>): string[] {
  const out: string[] = []
  for (const n of Object.values(wf)) {
    if (n.class_type === 'LoraLoaderModelOnly') out.push(String(n.inputs.lora_name))
  }
  return out
}

async function waitForOutputs(promptId: string): Promise<{ filename: string; subfolder: string }[]> {
  const deadline = Date.now() + RENDER_TIMEOUT_MS
  for (;;) {
    if (Date.now() > deadline) throw new Error(`render timed out after ${RENDER_TIMEOUT_MS}ms`)
    await new Promise((r) => setTimeout(r, 5000))
    const hist = await (await fetch(`${COMFY}/history/${promptId}`)).json()
    const entry = hist?.[promptId]
    if (!entry) continue
    if (entry.status?.status_str === 'error')
      throw new Error(JSON.stringify(entry.status).slice(0, 1500))
    if (entry.status?.completed) {
      return Object.values(entry.outputs ?? {}).flatMap((o) =>
        Object.values(o as Record<string, unknown[]>).flat(),
      ) as { filename: string; subfolder: string }[]
    }
  }
}

const params = (over: Partial<VideoGenerationParams> = {}): VideoGenerationParams => ({
  prompt: PROMPT,
  mode: 'ref2v',
  orientation: ORIENTATION,
  durationSeconds: DURATION_S,
  vramMode: VRAM,
  fps: 24,
  seed: SEED,
  refImages: [REF_IMAGE],
  ...over,
})

describe.skipIf(!LIVE)('reference mode: stock ref2va vs 10Eros Max', () => {
  beforeAll(async () => {
    expect(DIR, 'set REF2V_AB_DIR to an output directory').toBeTruthy()
    const r = await fetch(`${COMFY}/system_stats`).catch(() => null)
    if (!r?.ok) throw new Error(`ComfyUI is not reachable at ${COMFY}`)
  })

  it(
    'renders the same reference brief on both checkpoints',
    async () => {
      const legs = [
        { name: 'base', wf: params({ turbo: 'fast', ref2vTurbo: true }) },
        { name: 'eros', wf: params({ h3Checkpoint: 'eros' }) },
      ].map((l) => ({
        ...l,
        graph: minimaxH3Workflow.buildPrompt(l.wf) as unknown as Record<string, ComfyUIPromptNode>,
      }))

      // Assert both graphs before spending a GPU-minute on either: a leg that
      // quietly rendered the wrong checkpoint still produces a video, and it
      // looks exactly like a result.
      const [base, eros] = legs
      expect(nodeOf(base.graph, 'UNETLoader')!.inputs.unet_name).toBe(H3_REF2VA_CKPT)
      expect(loraChain(base.graph)).toEqual([H3_REF2V_TURBO_LORA])
      expect(nodeOf(eros.graph, 'UNETLoader')!.inputs.unet_name).toBe(H3_EROS.ckpt)
      expect(nodeOf(eros.graph, 'KSamplerSelect')!.inputs.sampler_name).toBe(H3_EROS.sampler)
      expect(loraChain(eros.graph)).toEqual([])
      for (const l of legs) {
        expect(nodeOf(l.graph, 'MiniMaxH3ReferenceToVideo'), `${l.name}: not reference mode`)
          .toBeDefined()
        expect(nodeOf(l.graph, 'LoadImage')!.inputs.image).toBe(REF_IMAGE)
        expect(nodeOf(l.graph, 'RandomNoise')!.inputs.noise_seed).toBe(SEED)
        // Equal work, or this is a step-count comparison wearing a checkpoint's
        // clothes — see the header.
        expect(nodeOf(l.graph, 'BasicScheduler')!.inputs.steps, `${l.name} steps`)
          .toBe(H3_EROS.steps)
      }

      const results: { leg: string; file: string; subfolder: string; seconds: number }[] = []
      for (const leg of legs) {
        // Back-to-back H3 renders have taken this ComfyUI down with a driver
        // fault, and one poisoned leg makes the comparison worthless.
        await fetch(`${COMFY}/free`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unload_models: true, free_memory: true }),
        }).catch(() => {})

        const started = Date.now()
        const r = await fetch(`${COMFY}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: leg.graph, client_id: 'raccoon-ref2v-ab' }),
        })
        const body = await r.json()
        expect(r.status, JSON.stringify(body).slice(0, 1500)).toBe(200)

        const outs = await waitForOutputs(body.prompt_id)
        const vid = outs.find((o) => /\.(mp4|webm|mkv)$/i.test(o.filename))
        expect(vid, `${leg.name}: no video output`).toBeTruthy()
        const seconds = Math.round((Date.now() - started) / 1000)
        console.log(`[ref2v-ab] ${leg.name} -> ${vid!.filename} in ${seconds}s`)
        results.push({ leg: leg.name, file: vid!.filename, subfolder: vid!.subfolder, seconds })
        fs.writeFileSync(path.join(DIR!, 'results.json'), JSON.stringify(results, null, 2))
      }

      expect(results).toHaveLength(2)
    },
    3 * RENDER_TIMEOUT_MS,
  )
})
