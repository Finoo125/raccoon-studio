/**
 * H3 audio A/B across a ComfyUI version bump.
 *
 * Renders a fixed set of briefs at a fixed seed and copies each clip into a
 * scratchpad directory **named after the ComfyUI version that produced it**,
 * read live from `/system_stats`. Run it once before the bump and once after;
 * `h3_audio_ab.py` then measures both sets.
 *
 *   cd app
 *   LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/h3-audio-ab.live.test.ts
 *
 * Why the version tag is read rather than passed: the whole value of an A/B is
 * knowing which build made which file, and a hand-typed label is the one part
 * of that a tired operator gets wrong. Mislabel the halves and the conclusion
 * inverts silently.
 *
 * Deliberate controls, each of which would otherwise confound the measurement:
 *  - **no Turbo LoRA.** A distilled LoRA reaches its result in very few steps
 *    and fine detail is what the dropped steps were for; it thickens the sound
 *    on its own. Measuring the sampler through one measures both.
 *  - **fixed seed, shared across versions.** The sampler changed, so the audio
 *    latent legitimately differs — but everything upstream of it must not.
 *  - **`POST /free` between renders.** Back-to-back H3 renders have killed this
 *    ComfyUI with a driver fault before; unloading between clips avoids both
 *    that and any resident-state carry-over into the next measurement.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import { minimaxH3Workflow } from './minimax-h3'
import { MINIMAX_H3_ASSETS } from '@/lib/models/minimax-h3-assets'
import type { VideoGenerationParams } from '@/types/video-workflow'

const LIVE = process.env.LIVE_RENDER === '1'
const COMFY = process.env.COMFYUI_URL ?? 'http://localhost:8188'
const OUT_ROOT =
  process.env.H3_AB_DIR ??
  path.join(os.tmpdir(), 'raccoon-h3-audio-ab')

/** Same seed on both sides of the bump, or the comparison measures the seed. */
const SEED = Number(process.env.LIVE_SEED ?? 424242)
const RENDER_TIMEOUT_MS = 30 * 60_000

/**
 * Three briefs, one per complaint levelled at the 0.31 audio sampler.
 *
 * They are H3 Base format (the doctrine `h3_brain.py` writes) because that is
 * what production sends; a bare sentence would exercise a path no user takes.
 */
const BRIEFS: { id: string; prompt: string; over?: Partial<VideoGenerationParams> }[] = [
  {
    // Noise floor: a near-silent scene has nowhere to hide hiss. Room tone is
    // the quietest thing H3 will still render as "sound" rather than silence.
    id: 'roomtone',
    prompt:
      'integrated_multimodal_description: [Shot 1] At 00:00.000 An empty wooden library ' +
      'reading room at dusk, tall shelves receding into shadow, dust visible in a single ' +
      'shaft of low sunlight. The camera holds still at a wide angle. Nobody speaks. Nothing ' +
      'moves except the dust.\n' +
      'overall_soundscape: A very quiet room tone. Distant muffled traffic far outside, ' +
      'barely present. No music, no voices, no footsteps.\n' +
      'non_diegetic_music: N/A',
  },
  {
    // HF artefacts: sibilance and consonant transients live above 8 kHz, which
    // is exactly where a sampler regression shows up first.
    id: 'speech',
    prompt:
      'integrated_multimodal_description: [Shot 1] At 00:00.000 Close-up of a woman in her ' +
      'thirties seated at a desk in a quiet office, speaking directly to camera in soft even ' +
      'light. <d>Six systems, six spreadsheets, and not a single one of them agrees with the ' +
      'others.</d> She pauses, then glances down at her notes.\n' +
      'overall_soundscape: Clear close-mic speech in a small treated room. Faint keyboard ' +
      'and air handling underneath.\n' +
      'non_diegetic_music: N/A',
  },
  {
    // Stereo instability: a wide moving source with a beat is where a wandering
    // image is audible. Percussion also pins timing, so drift shows up as well.
    id: 'music',
    prompt:
      'integrated_multimodal_description: [Shot 1] At 00:00.000 A wide shot of a small ' +
      'basement club, a four-piece band mid-song on a low stage, coloured lights sweeping ' +
      'across the room. The camera tracks slowly left to right across the front of the stage.\n' +
      'overall_soundscape: A live band playing a steady mid-tempo groove, drums and bass ' +
      'forward, cymbals bright, room reverb wide across the stereo field. Crowd murmur low ' +
      'underneath.\n' +
      'non_diegetic_music: N/A',
  },
]

/**
 * The same music brief on the Fast tier, because the non-turbo legs above
 * cannot see the change most likely to bite us.
 *
 * 0.34 rebases `MiniMaxH3SigmaShift`'s inner class from
 * `ModelSamplingDiscreteFlow` onto `ModelSamplingAV`. That node is in the graph
 * **only** for a Turbo tier, and our two tiers hardcode shift figures (12/6 and
 * 12/3) that their authors tuned against the old base. So the leg carrying the
 * most risk is exactly the one a plain t2v A/B leaves out — and Turbo is what
 * most renders actually use.
 */
BRIEFS.push({ ...BRIEFS[2], id: 'music-fast', over: { turbo: 'fast' } })

/** `H3_AB_ONLY=music-fast` renders one leg — for topping up a half-done set. */
const ONLY = process.env.H3_AB_ONLY?.split(',').map((s) => s.trim()).filter(Boolean)

const params = (over: Partial<VideoGenerationParams> = {}): VideoGenerationParams => ({
  prompt: '',
  mode: 't2v',
  orientation: 'landscape',
  durationSeconds: 5,
  fps: 24,
  seed: SEED,
  vramMode: 'low',
  turbo: false,
  ...over,
})

async function comfyVersion(): Promise<string> {
  const s = await (await fetch(`${COMFY}/system_stats`)).json()
  const v = s?.system?.comfyui_version
  if (!v) throw new Error('ComfyUI did not report a version')
  return String(v)
}

async function waitForOutputs(promptId: string): Promise<{ filename: string; subfolder: string }[]> {
  const deadline = Date.now() + RENDER_TIMEOUT_MS
  for (;;) {
    if (Date.now() > deadline) throw new Error(`render timed out after ${RENDER_TIMEOUT_MS}ms`)
    await new Promise((r) => setTimeout(r, 5000))
    const hist = await (await fetch(`${COMFY}/history/${promptId}`)).json()
    const entry = hist?.[promptId]
    if (!entry) continue
    if (entry.status?.status_str === 'error') throw new Error(JSON.stringify(entry.status).slice(0, 800))
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
  ] as [string, string][]) {
    const d = await (await fetch(`${COMFY}/object_info/${cls}`)).json().catch(() => null)
    for (const n of d?.[cls]?.input?.required?.[field]?.[0] ?? []) out.add(String(n))
  }
  return out
}

describe.skipIf(!LIVE)('MiniMax H3 audio A/B', () => {
  beforeAll(async () => {
    const r = await fetch(`${COMFY}/system_stats`).catch(() => null)
    if (!r?.ok) throw new Error(`ComfyUI is not reachable at ${COMFY}`)
  })

  it(
    'renders the A/B briefs and files them under the running ComfyUI version',
    async () => {
      const version = await comfyVersion()
      const dir = path.join(OUT_ROOT, `v${version}`)
      fs.mkdirSync(dir, { recursive: true })
      console.log(`[h3-ab] ComfyUI ${version} -> ${dir}`)

      const have = await installedModels()
      const absent = MINIMAX_H3_ASSETS.filter((a) => !a.optional).filter(
        (a) => !have.has(a.name) && ![...have].some((n) => n.endsWith('/' + a.name)),
      )
      if (absent.length) {
        console.warn(`[h3-ab] skipping — not installed: ${absent.map((a) => a.name).join(', ')}`)
        return
      }

      const todo = ONLY ? BRIEFS.filter((b) => ONLY.includes(b.id)) : BRIEFS
      expect(todo.length, `H3_AB_ONLY matched nothing: ${ONLY?.join(',')}`).toBeGreaterThan(0)

      for (const brief of todo) {
        // Unload between clips: back-to-back H3 renders have taken this
        // ComfyUI down with a driver fault, and a half-measured A/B is worse
        // than none.
        await fetch(`${COMFY}/free`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unload_models: true, free_memory: true }),
        }).catch(() => {})

        const started = Date.now()
        const r = await fetch(`${COMFY}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: minimaxH3Workflow.buildPrompt(params({ prompt: brief.prompt, ...brief.over })),
            client_id: 'raccoon-h3-audio-ab',
          }),
        })
        const body = await r.json()
        expect(r.status, JSON.stringify(body).slice(0, 800)).toBe(200)

        const outs = await waitForOutputs(body.prompt_id)
        const mp4 = outs.find((o) => o.filename?.endsWith('.mp4'))
        expect(mp4, `no mp4 for ${brief.id}: ${JSON.stringify(outs)}`).toBeTruthy()

        const url = `${COMFY}/view?filename=${encodeURIComponent(mp4!.filename)}&subfolder=${encodeURIComponent(mp4!.subfolder ?? '')}&type=output`
        const bytes = Buffer.from(await (await fetch(url)).arrayBuffer())
        const dest = path.join(dir, `${brief.id}.mp4`)
        fs.writeFileSync(dest, bytes)
        console.log(
          `[h3-ab] ${brief.id}: ${((Date.now() - started) / 1000).toFixed(0)}s, ${(bytes.length / 1e6).toFixed(2)} MB -> ${dest}`,
        )
      }
    },
    RENDER_TIMEOUT_MS * BRIEFS.length,
  )
})
