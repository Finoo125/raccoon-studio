/**
 * Build an actual longer video: render, continue, continue, join.
 *
 *   cd app
 *   LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/h3-chain.live.test.ts
 *
 * Needs ComfyUI **and** the app's dev server, because the join is an API route
 * (`/api/video/join`) and running it for real is the point — the parts are
 * already unit-tested, what is not proven is that they compose.
 *
 * The assertion that matters is the **duration arithmetic**. Each continuation
 * is sampled at `durationSeconds` but delivers `H3_CONTEXT_FRAMES` fewer
 * frames, so a chain's length is not `links × duration`. If the head trim were
 * off, or the join silently dropped a clip, or the pinned second came back into
 * the delivery, this is the number that moves — and nothing else in the
 * pipeline would complain.
 *
 * `H3_CHAIN_LINKS` sets the chain length (default 3).
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  minimaxH3Workflow,
  h3FrameCount,
  h3DeliveredSeconds,
  H3_CONTEXT_FRAMES,
  H3_FPS,
} from './minimax-h3'
import { MINIMAX_H3_ASSETS } from '@/lib/models/minimax-h3-assets'
import type { VideoGenerationParams } from '@/types/video-workflow'

const execFileAsync = promisify(execFile)
const LIVE = process.env.LIVE_RENDER === '1'
const COMFY = process.env.COMFYUI_URL ?? 'http://localhost:8188'
const APP = process.env.APP_URL ?? 'http://localhost:3000'
const LINKS = Number(process.env.H3_CHAIN_LINKS ?? 3)
const DURATION_S = 5
const RENDER_TIMEOUT_MS = 30 * 60_000

/**
 * One brief, continued. The prompt is deliberately unchanged between links:
 * H3 renders a *contradicting* prompt as a union with what it was shown rather
 * than replacing it, so "same prompt" is the safe default the UI also uses.
 */
const PROMPT =
  'integrated_multimodal_description: [Shot 1] At 00:00.000 A lone cyclist rides steadily along ' +
  'a coastal road at sunrise, sea on the left, low golden light. The camera tracks alongside at ' +
  'a constant speed, holding the rider in profile. The pace never changes.\n' +
  'overall_soundscape: Tyres humming on tarmac at a constant speed, steady wind, distant surf, ' +
  'occasional gulls.\n' +
  'non_diegetic_music: N/A'

const params = (over: Partial<VideoGenerationParams> = {}): VideoGenerationParams => ({
  prompt: PROMPT,
  mode: 't2v',
  orientation: 'landscape',
  durationSeconds: DURATION_S,
  fps: 24,
  seed: -1,
  vramMode: 'low',
  // Turbo off: distillation is documented to hurt chained renders, and a chain
  // is where any loss compounds.
  turbo: false,
  ...over,
})

type Out = { subfolder: string; filename: string }

async function render(prompt: unknown, label: string): Promise<Out> {
  await fetch(`${COMFY}/free`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  }).catch(() => {})

  const started = Date.now()
  const r = await fetch(`${COMFY}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, client_id: 'raccoon-h3-chain' }),
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
      ) as Out[]
      const mp4 = files.find((f) => f.filename?.endsWith('.mp4'))
      if (!mp4) throw new Error(`${label}: no mp4 in ${JSON.stringify(files)}`)
      console.log(`[chain] ${label}: ${((Date.now() - started) / 1000).toFixed(0)}s -> ${mp4.filename}`)
      return { subfolder: mp4.subfolder ?? '', filename: mp4.filename }
    }
  }
}

const outputPath = (o: Out) => (o.subfolder ? `${o.subfolder}/${o.filename}` : o.filename)

/** Duration and audio rate, straight off the file. */
async function probe(url: string): Promise<{ seconds: number; rate: number }> {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
  const tmp = `${process.env.TEMP ?? '/tmp'}/raccoon-chain-probe.mp4`
  await (await import('node:fs')).promises.writeFile(tmp, buf)
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=sample_rate,codec_type',
    '-of', 'json', tmp,
  ])
  const j = JSON.parse(stdout)
  const audio = (j.streams ?? []).find((s: { codec_type: string }) => s.codec_type === 'audio')
  return { seconds: Number(j.format.duration), rate: Number(audio?.sample_rate ?? 0) }
}

describe.skipIf(!LIVE)('MiniMax H3 chain — build a longer clip', () => {
  beforeAll(async () => {
    if (!(await fetch(`${COMFY}/system_stats`).catch(() => null))?.ok) {
      throw new Error(`ComfyUI is not reachable at ${COMFY}`)
    }
    if (!(await fetch(`${APP}/api/gallery?media=video`).catch(() => null))?.ok) {
      throw new Error(`The app is not reachable at ${APP} — the join runs through its API route`)
    }
  })

  it(
    `chains ${LINKS} clips and joins them into one video`,
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
        console.warn(`[chain] skipping — not installed: ${absent.map((a) => a.name).join(', ')}`)
        return
      }

      const clips: Out[] = [await render(minimaxH3Workflow.buildPrompt(params()), 'clip 1 (source)')]
      for (let i = 2; i <= LINKS; i++) {
        clips.push(
          await render(
            minimaxH3Workflow.buildPrompt(params({ continueFrom: outputPath(clips[i - 2]) })),
            `clip ${i} (continuation)`,
          ),
        )
      }

      const res = await fetch(`${APP}/api/video/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clips }),
      })
      const joined = await res.json()
      expect(res.status, JSON.stringify(joined).slice(0, 600)).toBe(200)
      expect(joined.clips).toBe(LINKS)

      const url = `${APP}/api/gallery/file?filename=${encodeURIComponent(joined.filename)}&subfolder=${encodeURIComponent(joined.subfolder)}`
      const viaComfy = `${COMFY}/view?filename=${encodeURIComponent(joined.filename)}&subfolder=${encodeURIComponent(joined.subfolder)}&type=output`
      const got = await probe(viaComfy).catch(() => probe(url))

      // The whole point. Clip 1 is delivered whole; every continuation loses
      // its pinned head. Getting `links × duration` here would mean the trim
      // never happened and each join repeats a second of the previous clip.
      const sourceS = h3FrameCount(DURATION_S) / H3_FPS
      const expected = sourceS + (LINKS - 1) * h3DeliveredSeconds(DURATION_S)
      console.log(
        `[chain] joined ${LINKS} clips: ${got.seconds.toFixed(2)}s ` +
          `(expected ${expected.toFixed(2)}s; naive ${(LINKS * sourceS).toFixed(2)}s would mean no trim)`,
      )
      expect(got.seconds).toBeCloseTo(expected, 1)
      // A stream copy cannot change rate partway; H3 is 32 kHz, not 48.
      expect(got.rate).toBe(32000)
      // And the trim really is doing something.
      expect(expected).toBeLessThan(LINKS * sourceS - (LINKS - 1) * (H3_CONTEXT_FRAMES / H3_FPS) + 0.01)
    },
    RENDER_TIMEOUT_MS,
  )
})
