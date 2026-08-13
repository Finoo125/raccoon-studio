/**
 * Live Director render against a running ComfyUI.
 *
 * Skipped unless `LIVE_RENDER=1`, because it needs the real stack (ComfyUI +
 * LTX 2.3 weights) and takes minutes. Everything else in the suite stays
 * offline and fast.
 *
 *   cd app
 *   LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/ltx23-director.live.test.ts
 *
 * It takes real images out of the gallery, pins them on the timeline as
 * keyframes, and drives the documented headless path end to end:
 * `buildPrompt` -> `POST /prompt` -> poll `/history` -> probe the mp4 on disk.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { ltx23DirectorWorkflow } from './ltx23-director'
import { emptyTimeline, totalFrames, type DirectorTimeline } from './director-timeline'
import type { VideoGenerationParams } from '@/types/video-workflow'

const LIVE = process.env.LIVE_RENDER === '1'

const DURATION_S = 5
const FPS = 30
/**
 * Fresh every run, and logged so a failure can be replayed with
 * `LIVE_SEED=<n>`. A fixed seed makes the graph byte-identical to the last run,
 * and ComfyUI's execution cache then serves it: the second run "passed" in 10 s
 * instead of 130 s, having sampled nothing. A smoke test that a broken model
 * would still pass is worse than no smoke test.
 */
const SEED = Number(process.env.LIVE_SEED ?? Date.now() % 9_000_000_000)
/** RIFE is on by default and doubles the frame rate on the way out. */
const RIFE_MULTIPLIER = 2

/** vitest's default 5 s cap is nowhere near a real render. */
const RENDER_TIMEOUT_MS = 25 * 60_000
const POLL_MS = 5_000

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

/** Width/height straight out of the PNG IHDR — no image library needed. */
function pngSize(file: string): { w: number; h: number } {
  const head = Buffer.alloc(24)
  const fd = fs.openSync(file, 'r')
  try {
    fs.readSync(fd, head, 0, 24, 0)
  } finally {
    fs.closeSync(fd)
  }
  expect(head.subarray(1, 4).toString()).toBe('PNG')
  return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) }
}

describe.skipIf(!LIVE)('LTX 2.3 Director — live render', () => {
  const env = { ...readEnvLocal(), ...process.env }
  const base = (env.COMFYUI_BASE_URL || 'http://127.0.0.1:8188').replace(/\/$/, '')
  const outputDir = env.COMFYUI_OUTPUT_DIR ?? ''

  let sources: { file: string; name: string; w: number; h: number }[] = []
  let timeline: DirectorTimeline
  let params: VideoGenerationParams

  beforeAll(async () => {
    const stats = await fetch(`${base}/system_stats`).catch(() => null)
    if (!stats?.ok) throw new Error(`ComfyUI is not answering on ${base} — start it first`)
    expect(fs.existsSync(outputDir)).toBe(true)

    // Newest gallery stills first. Two is enough to prove the keyframe path
    // both sizes the render and lands at the right second.
    const picked = fs
      .readdirSync(outputDir)
      .filter((f) => f.toLowerCase().endsWith('.png'))
      .map((f) => path.join(outputDir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      .slice(0, 2)
    expect(picked.length, 'need at least 2 gallery PNGs to test with').toBe(2)

    // Upload each into ComfyUI's input dir — exactly what the timeline's own
    // "add image" does, via the same endpoint.
    sources = []
    for (const file of picked) {
      const form = new FormData()
      form.append('image', new Blob([fs.readFileSync(file)], { type: 'image/png' }), path.basename(file))
      form.append('overwrite', 'true')
      form.append('type', 'input')
      const res = await fetch(`${base}/upload/image`, { method: 'POST', body: form })
      expect(res.ok, `upload failed for ${path.basename(file)}`).toBe(true)
      const data = (await res.json()) as { name: string; subfolder?: string }
      const { w, h } = pngSize(file)
      sources.push({ file, name: data.subfolder ? `${data.subfolder}/${data.name}` : data.name, w, h })
    }

    // Two shots, each with its own prompt, and a gallery still pinned at the
    // start of each — the whole point of Director mode in one timeline.
    const mid = DURATION_S / 2
    timeline = {
      ...emptyTimeline(DURATION_S, FPS),
      globalPrompt: 'cinematic footage, natural light, shallow depth of field',
      // Prompt and picture ride on the same block — upstream's model, and ours
      // since 2026-08-09.
      segments: [
        {
          id: 'seg-1', startSec: 0, lengthSec: mid,
          prompt: 'slow push in, the subject holds still',
          file: sources[0].name, strength: 1, width: sources[0].w, height: sources[0].h,
        },
        {
          id: 'seg-2', startSec: mid, lengthSec: mid,
          prompt: 'the camera pulls back to a wider view',
          file: sources[1].name, strength: 1, width: sources[1].w, height: sources[1].h,
        },
      ],
    }
    params = {
      prompt: timeline.globalPrompt,
      mode: 'director',
      orientation: 'landscape',
      durationSeconds: DURATION_S,
      fps: FPS,
      seed: SEED,
      vramMode: 'low', // smallest pixel budget — this is a smoke test, not a beauty shot
      timeline,
    }
  }, 120_000)

  it('builds a graph that carries the timeline into the Director node', () => {
    const wf = ltx23DirectorWorkflow.buildPrompt(params) as Record<string, { class_type: string; inputs: Record<string, unknown> }>
    const dir = wf['dir']
    expect(dir, 'director node present').toBeTruthy()

    expect(dir.inputs.global_prompt).toBe(timeline.globalPrompt)
    expect(dir.inputs.duration_seconds).toBe(DURATION_S)
    expect(dir.inputs.frame_rate).toBe(FPS)
    expect(dir.inputs.duration_frames).toBe(totalFrames(timeline))

    // Both stills reached the node, and both shot prompts with them.
    const serialised = JSON.stringify(dir.inputs)
    for (const s of sources) expect(serialised).toContain(s.name)
    for (const seg of timeline.segments) expect(serialised).toContain(seg.prompt)

    // Director builds the half-size first pass; the tail upscales x2. Both
    // halves must stay divisible by 32 or the sampler rejects the latent.
    const w = dir.inputs.custom_width as number
    const h = dir.inputs.custom_height as number
    expect(w % 32, `custom_width ${w} divisible by 32`).toBe(0)
    expect(h % 32, `custom_height ${h} divisible by 32`).toBe(0)
    // The render follows the FIRST keyframe's aspect, not the orientation button.
    expect(w / h).toBeCloseTo(sources[0].w / sources[0].h, 1)

    // Unused lanes must be disarmed or the node waits on an empty track.
    expect(dir.inputs.use_custom_audio).toBe(false)
    expect(dir.inputs.use_custom_motion).toBe(false)

    const save = Object.values(wf).find(
      (n) => n.class_type === 'VHS_VideoCombine' && n.inputs.save_output === true,
    )
    expect(save, 'a saving VideoCombine survives into the graph').toBeTruthy()
    expect(String(save!.inputs.filename_prefix)).toContain('LTX23Director_')
  })

  it(
    'renders the clip end to end and writes a playable video',
    async () => {
      const prompt = ltx23DirectorWorkflow.buildPrompt(params)
      const res = await fetch(`${base}/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, client_id: 'raccoon-live-test' }),
      })
      const body = await res.text()
      expect(res.ok, `POST /prompt rejected the graph: ${body}`).toBe(true)
      const { prompt_id } = JSON.parse(body) as { prompt_id: string }
      expect(prompt_id).toBeTruthy()
      console.log(`  queued ${prompt_id} — ${DURATION_S}s @ ${FPS}fps, ${timeline.segments.filter((s) => s.file).length} keyframes, seed ${SEED}`)

      const started = Date.now()
      let entry: {
        status?: { completed?: boolean; status_str?: string; messages?: unknown[] }
        outputs?: Record<string, { gifs?: { filename: string; subfolder: string; format?: string }[] }>
      } | undefined

      while (Date.now() - started < RENDER_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        const hist = await fetch(`${base}/history/${prompt_id}`).then((r) => r.json()).catch(() => ({}))
        entry = (hist as Record<string, typeof entry>)[prompt_id]
        if (entry?.status?.completed !== undefined || entry?.status?.status_str === 'error') break
      }

      const mins = ((Date.now() - started) / 60_000).toFixed(1)
      expect(entry, `no /history entry after ${mins} min — the job never finished`).toBeTruthy()
      expect(
        entry!.status?.status_str,
        `render failed: ${JSON.stringify(entry!.status?.messages)?.slice(0, 800)}`,
      ).toBe('success')
      console.log(`  finished in ${mins} min`)

      // The saving VideoCombine reports its file in the history outputs.
      const videos = Object.values(entry!.outputs ?? {}).flatMap((o) => o.gifs ?? [])
      expect(videos.length, 'history reports an output video').toBeGreaterThan(0)
      const produced = videos.find((v) => v.filename.includes('LTX23Director_')) ?? videos[0]

      const onDisk = path.join(outputDir, produced.subfolder, produced.filename)
      expect(fs.existsSync(onDisk), `output missing on disk: ${onDisk}`).toBe(true)
      const kb = fs.statSync(onDisk).size / 1024
      expect(kb, `output is only ${kb.toFixed(0)} KB — that is not a real clip`).toBeGreaterThan(100)
      console.log(`  wrote ${produced.subfolder}/${produced.filename} (${kb.toFixed(0)} KB)`)

      // Probe it rather than trusting the filename: a truncated or audio-only
      // mp4 would still exist and still be big.
      const probe = JSON.parse(
        execFileSync(
          'ffprobe',
          ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', onDisk],
          { encoding: 'utf8' },
        ),
      ) as { streams: { codec_type: string; nb_frames?: string; width?: number; height?: number }[]; format: { duration: string } }

      const video = probe.streams.find((s) => s.codec_type === 'video')
      expect(video, 'the file contains a video stream').toBeTruthy()
      expect(Number(probe.format.duration)).toBeCloseTo(DURATION_S, 0)
      expect(video!.width! % 2).toBe(0)
      expect(video!.height! % 2).toBe(0)
      // The first keyframe's aspect should have survived all the way to the file.
      expect(video!.width! / video!.height!).toBeCloseTo(sources[0].w / sources[0].h, 1)

      const frames = Number(video!.nb_frames ?? 0)
      if (frames > 0) {
        expect(frames, `expected ~${totalFrames(timeline) * RIFE_MULTIPLIER} frames after RIFE`)
          .toBeGreaterThan(totalFrames(timeline))
      }
      console.log(`  ${video!.width}x${video!.height}, ${Number(probe.format.duration).toFixed(2)}s, ${frames || '?'} frames`)

      // Guard the expensive failure mode: DynamicVRAM can corrupt a resident
      // fp8_scaled model into saturated tiled garbage, which reads as a broken
      // VAE or a bad checkpoint. It has an objective metric — mean RGB channel
      // spread is ~32-48 on a clean colour render and ~90-113 on a corrupted
      // one — so measure it rather than eyeballing. Greyscale sources land near
      // zero, hence a ceiling rather than a band.
      const sampleW = 160
      const sampleH = Math.round((sampleW * video!.height!) / video!.width!)
      const rgb = execFileSync(
        'ffmpeg',
        ['-v', 'error', '-i', onDisk, '-vf', `select=not(mod(n\\,60)),scale=${sampleW}:${sampleH}`,
          '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
        { maxBuffer: 256 * 1024 * 1024 },
      ) as unknown as Buffer
      expect(rgb.length, 'ffmpeg returned no pixels to measure').toBeGreaterThan(0)
      let spread = 0
      for (let i = 0; i + 2 < rgb.length; i += 3) {
        spread += Math.max(rgb[i], rgb[i + 1], rgb[i + 2]) - Math.min(rgb[i], rgb[i + 1], rgb[i + 2])
      }
      const mean = spread / (rgb.length / 3)
      console.log(`  mean channel spread ${mean.toFixed(1)} (clean colour ~32-48, corrupted ~90-113)`)
      expect(mean, `channel spread ${mean.toFixed(1)} is in DynamicVRAM-corruption territory`)
        .toBeLessThan(60)
    },
    RENDER_TIMEOUT_MS + 60_000,
  )
})
