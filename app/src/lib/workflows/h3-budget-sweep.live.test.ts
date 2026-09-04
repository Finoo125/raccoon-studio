/**
 * `BUDGET_MP` calibration — what resolution can this box actually render?
 *
 *   cd app
 *   LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/h3-budget-sweep.live.test.ts
 *
 * Renders one brief at a fixed seed across a ladder of canvas sizes, recording
 * wall time and peak VRAM for each, then upscales the smallest render to the
 * largest render's exact size with RTX VSR so the two can be compared pixel for
 * pixel. That last leg is the whole point: it answers "render big" vs "render
 * small and upscale" with the *same output resolution* on both sides, which is
 * the only way the comparison means anything.
 *
 * Why the sizes are patched onto the built graph rather than driven through
 * `vramMode`: two of the rungs are deliberately outside what `BUDGET_MP` can
 * currently produce. 1344x768 is MiniMax's own trained canvas cap
 * (`nodes_minimax_h3.py:28`, `MAX_PIXELS = 768 * 1344`) and 1536x864 is above
 * it — and `adapt_canvas` is only applied to the *reference video* path, never
 * to the main width/height, so nothing in ComfyUI stops us going over. Whether
 * that is a good idea is exactly what the above-cap leg is here to find out:
 * the cap is a training-distribution limit, so it fails as artefacts, not as an
 * error, and only looking at the frames can catch it.
 *
 * `POST /free` between legs — back-to-back H3 renders have taken this ComfyUI
 * down with a driver fault, and a half-finished sweep is worse than none.
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
  process.env.H3_BUDGET_DIR ??
  path.join(os.tmpdir(), 'raccoon-h3-budget')

const SEED = Number(process.env.LIVE_SEED ?? 707707)
const DURATION_S = Number(process.env.H3_BUDGET_SECONDS ?? 5)
const RENDER_TIMEOUT_MS = 40 * 60_000

/** Same brief as the sampler A/B, so the two sets stay comparable. */
const BRIEF =
  'integrated_multimodal_description: [Shot 1] At 00:00.000 A woman in her thirties in a ' +
  'weathered leather jacket walks steadily along a rain-wet city street at night, neon signs ' +
  'reflecting in the puddles behind her. The camera tracks backwards ahead of her at a slow ' +
  'even speed, holding her in a medium shot. <d>Every single one of these streets looks the ' +
  'same after midnight.</d> She glances over her shoulder, then keeps walking.\n' +
  'overall_soundscape: Clear close speech over wet footsteps on pavement, distant traffic and ' +
  'a faint hum of neon. Light rain throughout.\n' +
  'non_diegetic_music: N/A'

/** The canvas ladder. `note` is what each rung is evidence about. */
const RUNGS: { id: string; w: number; h: number; note: string }[] = [
  { id: 'mp041', w: 864, h: 480, note: 'BUDGET_MP.low today — ComfyUI default, the one grounded figure' },
  { id: 'mp066', w: 1088, h: 608, note: 'BUDGET_MP.medium today — interpolated, never measured' },
  { id: 'mp080', w: 1184, h: 672, note: 'BUDGET_MP.high today — interpolated, never measured' },
  { id: 'mp103', w: 1344, h: 768, note: "MiniMax's own trained canvas cap" },
  { id: 'mp133', w: 1536, h: 864, note: 'above the cap — expect artefacts, not an error' },
]

const ONLY = process.env.H3_BUDGET_ONLY?.split(',').map((s) => s.trim()).filter(Boolean)

const params = (): VideoGenerationParams => ({
  prompt: BRIEF,
  mode: 't2v',
  orientation: 'landscape',
  durationSeconds: DURATION_S,
  fps: 24,
  seed: SEED,
  vramMode: 'low',
  turbo: 'fast',
})

const nodeOf = (wf: Record<string, ComfyUIPromptNode>, cls: string) =>
  Object.values(wf).find((n) => n.class_type === cls)

/**
 * Poll free VRAM until stopped, and report the low-water mark.
 *
 * Free VRAM rather than torch's own allocation figure, because the number that
 * decides whether a smaller card can run this is what the *device* has left,
 * which includes the allocator's cached blocks and anything else resident.
 */
function vramWatch() {
  let min = Infinity
  let total = 0
  let stop = false
  const loop = (async () => {
    while (!stop) {
      try {
        const s = await (await fetch(`${COMFY}/system_stats`)).json()
        const d = s?.devices?.[0]
        if (d) {
          total = d.vram_total
          min = Math.min(min, d.vram_free)
        }
      } catch {
        /* a blip mid-render is not worth failing the sweep over */
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
  })()
  return {
    async done() {
      stop = true
      await loop
      return { peakUsedGb: (total - min) / 2 ** 30, totalGb: total / 2 ** 30 }
    },
  }
}

async function waitForOutputs(promptId: string): Promise<{ filename: string; subfolder: string }[]> {
  const deadline = Date.now() + RENDER_TIMEOUT_MS
  for (;;) {
    if (Date.now() > deadline) throw new Error(`render timed out after ${RENDER_TIMEOUT_MS}ms`)
    await new Promise((r) => setTimeout(r, 3000))
    const hist = await (await fetch(`${COMFY}/history/${promptId}`)).json()
    const entry = hist?.[promptId]
    if (!entry) continue
    if (entry.status?.status_str === 'error')
      throw new Error(JSON.stringify(entry.status).slice(0, 900))
    if (entry.status?.completed) {
      return Object.values(entry.outputs ?? {}).flatMap((o) =>
        Object.values(o as Record<string, unknown[]>).flat(),
      ) as { filename: string; subfolder: string }[]
    }
  }
}

async function fetchTo(mp4: { filename: string; subfolder: string }, dest: string) {
  const url = `${COMFY}/view?filename=${encodeURIComponent(mp4.filename)}&subfolder=${encodeURIComponent(mp4.subfolder ?? '')}&type=output`
  fs.writeFileSync(dest, Buffer.from(await (await fetch(url)).arrayBuffer()))
}

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

describe.skipIf(!LIVE)('MiniMax H3 budget sweep', () => {
  beforeAll(async () => {
    const r = await fetch(`${COMFY}/system_stats`).catch(() => null)
    if (!r?.ok) throw new Error(`ComfyUI is not reachable at ${COMFY}`)
  })

  it(
    'renders the canvas ladder and records wall time and peak VRAM',
    async () => {
      fs.mkdirSync(OUT_DIR, { recursive: true })
      const have = await installedModels()
      const need = [
        ...MINIMAX_H3_ASSETS.filter((a) => !a.optional).map((a) => a.name),
        H3_TURBO.fast.lora,
      ]
      const absent = need.filter((n) => !have.has(n) && ![...have].some((x) => x.endsWith('/' + n)))
      if (absent.length) {
        console.warn(`[h3-budget] skipping — not installed: ${absent.join(', ')}`)
        return
      }

      const todo = ONLY ? RUNGS.filter((r) => ONLY.includes(r.id)) : RUNGS
      expect(todo.length, `H3_BUDGET_ONLY matched nothing: ${ONLY?.join(',')}`).toBeGreaterThan(0)
      const results: Record<string, unknown> = {}

      for (const rung of todo) {
        await fetch(`${COMFY}/free`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unload_models: true, free_memory: true }),
        }).catch(() => {})

        const wf = minimaxH3Workflow.buildPrompt(params()) as Record<string, ComfyUIPromptNode>
        const cond = nodeOf(wf, 'MiniMaxH3ImageToVideo')!
        cond.inputs.width = rung.w
        cond.inputs.height = rung.h

        const watch = vramWatch()
        const started = Date.now()
        let failure: string | null = null
        try {
          const r = await fetch(`${COMFY}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: wf, client_id: 'raccoon-h3-budget' }),
          })
          const body = await r.json()
          expect(r.status, JSON.stringify(body).slice(0, 800)).toBe(200)
          const outs = await waitForOutputs(body.prompt_id)
          const mp4 = outs.find((o) => o.filename?.endsWith('.mp4'))
          expect(mp4, `no mp4 for ${rung.id}`).toBeTruthy()
          await fetchTo(mp4!, path.join(OUT_DIR, `${rung.id}.mp4`))
        } catch (e) {
          // An OOM at the top of the ladder is a RESULT, not a broken test —
          // recording where it stops is the entire point of a ceiling sweep.
          failure = e instanceof Error ? e.message.slice(0, 400) : String(e)
        }
        const vram = await watch.done()
        results[rung.id] = {
          ...rung,
          mp: +((rung.w * rung.h) / 1e6).toFixed(3),
          seconds: +((Date.now() - started) / 1000).toFixed(1),
          peakUsedGb: +vram.peakUsedGb.toFixed(2),
          totalGb: +vram.totalGb.toFixed(2),
          failure,
        }
        console.log(`[h3-budget] ${rung.id} ${rung.w}x${rung.h}`, JSON.stringify(results[rung.id]))
        fs.writeFileSync(
          path.join(OUT_DIR, 'sweep.json'),
          JSON.stringify({ seed: SEED, durationS: DURATION_S, results }, null, 2),
        )
      }
    },
    RENDER_TIMEOUT_MS,
  )

  it(
    'upscales the smallest render to the largest one\'s exact size with RTX VSR',
    async () => {
      const small = path.join(OUT_DIR, `${RUNGS[0].id}.mp4`)
      const target = RUNGS.find((r) => r.id === 'mp103')!
      if (!fs.existsSync(small)) {
        console.warn('[h3-budget] skipping VSR leg — run the ladder first')
        return
      }

      // Push the clip back into ComfyUI's input dir so LoadVideo can read it.
      const form = new FormData()
      form.append('image', new Blob([new Uint8Array(fs.readFileSync(small))]), 'h3_budget_src.mp4')
      form.append('overwrite', 'true')
      form.append('type', 'input')
      const up = await fetch(`${COMFY}/upload/image`, { method: 'POST', body: form })
      expect(up.ok, `upload failed: ${up.status}`).toBe(true)

      // Hand-built rather than routed through the builder: this graph renders
      // nothing, it only re-encodes an existing clip through the upscaler.
      // `resize_type` is a V3 dynamic combo, same prefixed-input convention as
      // the RCAS sharpen — see the note in `minimaxH3Workflow.buildPrompt`.
      const wf = {
        '1': { class_type: 'LoadVideo', inputs: { file: 'h3_budget_src.mp4' } },
        '2': { class_type: 'GetVideoComponents', inputs: { video: ['1', 0] } },
        '3': {
          class_type: 'RTXVideoSuperResolution',
          inputs: {
            images: ['2', 0],
            resize_type: 'target dimensions',
            'resize_type.width': target.w,
            'resize_type.height': target.h,
            quality: 'ULTRA',
          },
        },
        // Audio and fps carried straight through: the upscaler only touches
        // picture, and a clip that lost its generated soundtrack on the way to
        // a resolution comparison would be a different clip.
        '4': {
          class_type: 'CreateVideo',
          inputs: { images: ['3', 0], audio: ['2', 1], fps: ['2', 2] },
        },
        // `format` and `codec` are required, not optional — omitting them gets
        // past validation and dies at execution with a bare TypeError from
        // `SaveVideo.execute()`, after the upscale has already been paid for.
        '5': {
          class_type: 'SaveVideo',
          inputs: {
            video: ['4', 0],
            filename_prefix: 'h3budget/vsr',
            format: 'auto',
            codec: 'auto',
          },
        },
      }

      const started = Date.now()
      const r = await fetch(`${COMFY}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: wf, client_id: 'raccoon-h3-budget-vsr' }),
      })
      const body = await r.json()
      expect(r.status, JSON.stringify(body).slice(0, 800)).toBe(200)
      const outs = await waitForOutputs(body.prompt_id)
      const mp4 = outs.find((o) => o.filename?.endsWith('.mp4'))
      expect(mp4, `no mp4 from the VSR leg: ${JSON.stringify(outs)}`).toBeTruthy()
      await fetchTo(mp4!, path.join(OUT_DIR, 'vsr.mp4'))
      console.log(`[h3-budget] VSR ${RUNGS[0].id} -> ${target.w}x${target.h}: ${((Date.now() - started) / 1000).toFixed(1)}s`)
    },
    RENDER_TIMEOUT_MS,
  )
})
