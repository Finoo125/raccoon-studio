/**
 * Does an H3 continuation actually continue? — live mechanism proof.
 *
 *   cd app
 *   LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/h3-continuation.live.test.ts
 *
 * Everything else about this feature is plumbing that unit tests can hold. What
 * they cannot tell you is whether the model *honours* the pinned head, so this
 * renders three clips and hands them to `h3_continuation.py` to score:
 *
 *   A      the source clip.
 *   B_raw  a continuation of A, **with the head trim undone** so the pinned
 *          frames are still in the file. One render then yields both numbers:
 *          frames 0..21 are the pin (do they reproduce A's tail?) and frame 22
 *          is the first delivered frame (does it continue from A's last?).
 *   C      the control — B's seed and prompt, no continuation, so the guide is
 *          the only difference between them. Without it "B looks like A" proves
 *          nothing, because a clip rendered from the same prompt resembles its
 *          predecessor anyway. The fl2v verification made exactly that mistake
 *          first time round; the control is what turned "does it look right?"
 *          into a number.
 *
 * Film grain is OFF throughout: it re-rolls noise per frame, which would put
 * ~3/255 of difference into the pin-fidelity measurement for no reason. Turbo
 * is off too — distillation is documented to hurt chained renders.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import { minimaxH3Workflow, H3_CONTEXT_FRAMES } from './minimax-h3'
import { MINIMAX_H3_ASSETS } from '@/lib/models/minimax-h3-assets'
import type { VideoGenerationParams } from '@/types/video-workflow'
import type { ComfyUIPromptNode } from '@/types/comfyui'

const LIVE = process.env.LIVE_RENDER === '1'
const COMFY = process.env.COMFYUI_URL ?? 'http://localhost:8188'
const OUT_ROOT =
  process.env.H3_CONT_DIR ??
  path.join(os.tmpdir(), 'raccoon-h3-continuation')

/**
 * A gets its own seed; B and C share a second one.
 *
 * B and C must differ by the guide and *nothing else*, or the comparison
 * measures two changes at once. And C must not share A's seed either — with
 * the same prompt it would then be byte-identical to A, and "the control
 * resembles the source" would be an artefact of it *being* the source.
 */
const SEED_A = Number(process.env.LIVE_SEED ?? 20260829)
const SEED_B = SEED_A + 1
const RENDER_TIMEOUT_MS = 30 * 60_000

/**
 * Two briefs, because the video and audio halves need different material.
 *
 * `walk` is the picture test: continuous lateral motion, so a join that
 * invents its own velocity shows up immediately.
 *
 * `music` exists because the audio measure is a cross-correlation, and
 * **broadband noise cannot correlate with itself across time** however
 * perceptually continuous it is. Scoring rain and footsteps understates
 * continuity by construction; the 0.95+ figure this is judged against was
 * measured on dense beat-driven music for exactly that reason. Pick the brief
 * with `H3_CONT_BRIEF`.
 */
const BRIEFS: Record<string, string> = {
  walk:
    'integrated_multimodal_description: [Shot 1] At 00:00.000 A woman in a red coat walks steadily ' +
    'left to right along a wet city pavement at night, neon signs reflecting in the puddles. The ' +
    'camera tracks alongside her at walking pace, holding her in profile. She does not stop.\n' +
    'overall_soundscape: Steady footsteps on wet stone at a constant pace, light rain, distant ' +
    'traffic hum.\n' +
    'non_diegetic_music: N/A',
  music:
    'integrated_multimodal_description: [Shot 1] At 00:00.000 A drummer in a small rehearsal room ' +
    'plays a steady four-on-the-floor groove at a constant tempo, sticks striking the snare and ' +
    'hi-hat in strict time. The camera holds a medium shot on the kit. The tempo never changes.\n' +
    'overall_soundscape: A tight repeating drum groove at a constant tempo, snare and hi-hat ' +
    'forward, steady kick on every beat. No voices.\n' +
    'non_diegetic_music: N/A',
}
const BRIEF = process.env.H3_CONT_BRIEF ?? 'walk'
/** Per-brief, so a second run does not overwrite the first one's clips. */
const OUT = path.join(OUT_ROOT, BRIEF)
const PROMPT = BRIEFS[BRIEF] ?? BRIEFS.walk

const params = (over: Partial<VideoGenerationParams> = {}): VideoGenerationParams => ({
  prompt: PROMPT,
  mode: 't2v',
  orientation: 'landscape',
  durationSeconds: 5,
  fps: 24,
  seed: SEED_A,
  vramMode: 'low',
  turbo: false,
  filmGrain: false,
  ...over,
})

async function render(prompt: unknown, label: string): Promise<{ subfolder: string; filename: string }> {
  await fetch(`${COMFY}/free`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  }).catch(() => {})

  const started = Date.now()
  const r = await fetch(`${COMFY}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, client_id: 'raccoon-h3-continuation' }),
  })
  const body = await r.json()
  expect(r.status, `${label}: ${JSON.stringify(body).slice(0, 900)}`).toBe(200)

  const deadline = Date.now() + RENDER_TIMEOUT_MS
  for (;;) {
    if (Date.now() > deadline) throw new Error(`${label} timed out`)
    await new Promise((res) => setTimeout(res, 5000))
    const hist = await (await fetch(`${COMFY}/history/${body.prompt_id}`)).json()
    const entry = hist?.[body.prompt_id]
    if (!entry) continue
    if (entry.status?.status_str === 'error') {
      throw new Error(`${label}: ${JSON.stringify(entry.status).slice(0, 900)}`)
    }
    if (entry.status?.completed) {
      const files = Object.values(entry.outputs ?? {}).flatMap((o) =>
        Object.values(o as Record<string, unknown[]>).flat(),
      ) as { filename?: string; subfolder?: string }[]
      const mp4 = files.find((f) => f.filename?.endsWith('.mp4'))
      if (!mp4?.filename) throw new Error(`${label}: no mp4 in ${JSON.stringify(files)}`)
      console.log(`[h3-cont] ${label}: ${((Date.now() - started) / 1000).toFixed(0)}s -> ${mp4.filename}`)
      return { subfolder: mp4.subfolder ?? '', filename: mp4.filename }
    }
  }
}

async function download(out: { subfolder: string; filename: string }, as: string) {
  const url = `${COMFY}/view?filename=${encodeURIComponent(out.filename)}&subfolder=${encodeURIComponent(out.subfolder)}&type=output`
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer())
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, as), bytes)
}

/** What `continueFrom` wants: the clip's path relative to the output dir. */
const outputPath = (o: { subfolder: string; filename: string }) =>
  o.subfolder ? `${o.subfolder}/${o.filename}` : o.filename

/**
 * Undo the head trim so the pinned frames stay in the rendered file.
 *
 * Reaches through the two trim nodes to whatever fed them, rather than assuming
 * the decoders: with RIFE or grain in the graph the source is not the decoder,
 * and hardcoding it here would silently measure the wrong stream.
 */
function keepPinnedHead(wf: Record<string, ComfyUIPromptNode>): Record<string, ComfyUIPromptNode> {
  const video = Object.values(wf).find((n) => n.class_type === 'CreateVideo')!
  const [imgId] = video.inputs.images as [string, number]
  const [audId] = video.inputs.audio as [string, number]
  expect(wf[imgId].class_type, 'expected the image trim to feed CreateVideo').toBe('ImageFromBatch')
  expect(wf[audId].class_type, 'expected the audio trim to feed CreateVideo').toBe('TrimAudioDuration')
  video.inputs.images = wf[imgId].inputs.image
  video.inputs.audio = wf[audId].inputs.audio
  delete wf[imgId]
  delete wf[audId]
  return wf
}

describe.skipIf(!LIVE)('MiniMax H3 continuation — live', () => {
  beforeAll(async () => {
    const r = await fetch(`${COMFY}/system_stats`).catch(() => null)
    if (!r?.ok) throw new Error(`ComfyUI is not reachable at ${COMFY}`)
  })

  it('the continuation graph validates', async () => {
    const wf = minimaxH3Workflow.buildPrompt(params({ continueFrom: 'nope/does-not-exist.mp4' }))
    const r = await fetch(`${COMFY}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: wf, client_id: 'raccoon-h3-cont-validate' }),
    })
    const body = await r.json()
    if (r.status === 200) {
      // Accepted means the wiring is sound; cancel before it occupies the GPU.
      await fetch(`${COMFY}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delete: [body.prompt_id] }),
      }).catch(() => {})
      await fetch(`${COMFY}/interrupt`, { method: 'POST' }).catch(() => {})
      return
    }
    // The only acceptable complaint is from the loader we deliberately pointed
    // at a file that does not exist. Filtered by *node*, not by message:
    // ComfyUI reports a missing video as `custom_validation_failed`, a generic
    // type that no sensible message regex catches — matching on the wording was
    // how this test failed the first time it ran.
    const errs = Object.entries(
      (body.node_errors ?? {}) as Record<string, { class_type: string; errors: { type: string }[] }>,
    )
    const structural = errs
      .filter(([, n]) => n.class_type !== 'LoadVideo')
      .flatMap(([, n]) => n.errors.map((e) => `${n.class_type}: ${e.type}`))
    expect(structural, JSON.stringify(body).slice(0, 900)).toEqual([])
  })

  it(
    'renders source, continuation and control for scoring',
    async () => {
      const have = new Set<string>()
      for (const [cls, field] of [
        ['UNETLoader', 'unet_name'],
        ['CLIPLoader', 'clip_name'],
        ['VAELoader', 'vae_name'],
      ] as [string, string][]) {
        const d = await (await fetch(`${COMFY}/object_info/${cls}`)).json().catch(() => null)
        for (const n of d?.[cls]?.input?.required?.[field]?.[0] ?? []) have.add(String(n))
      }
      const absent = MINIMAX_H3_ASSETS.filter((a) => !a.optional).filter(
        (a) => !have.has(a.name) && ![...have].some((n) => n.endsWith('/' + a.name)),
      )
      if (absent.length) {
        console.warn(`[h3-cont] skipping — not installed: ${absent.map((a) => a.name).join(', ')}`)
        return
      }

      const a = await render(minimaxH3Workflow.buildPrompt(params()), 'A (source)')
      await download(a, 'A.mp4')

      const contGraph = keepPinnedHead(
        minimaxH3Workflow.buildPrompt(
          params({ continueFrom: outputPath(a), seed: SEED_B }),
        ) as unknown as Record<string, ComfyUIPromptNode>,
      )
      const b = await render(contGraph, 'B_raw (continuation, head kept)')
      await download(b, 'B_raw.mp4')

      // Same seed and prompt, no guide: the floor that says how much of any
      // resemblance is just "same prompt, same seed".
      const c = await render(minimaxH3Workflow.buildPrompt(params({ seed: SEED_B })), 'C (control)')
      await download(c, 'C.mp4')

      for (const f of ['A.mp4', 'B_raw.mp4', 'C.mp4']) {
        expect(fs.existsSync(path.join(OUT, f)), `${f} missing`).toBe(true)
      }
      console.log(`[h3-cont] wrote A/B_raw/C to ${OUT} (pinned head = ${H3_CONTEXT_FRAMES} frames)`)
    },
    RENDER_TIMEOUT_MS * 3,
  )
})
