/**
 * How well do H3 continuations join? Every seam of a chain, scored.
 * Built 2026-10-02 to pick between a 22-frame AddGuide pin and the masked
 * prefix (feature list items 7+8); the masked prefix won and replaced it —
 * the AddGuide numbers live on `H3_CONTEXT_FRAMES`. Kept as the regression
 * check for that choice: re-run it after a ComfyUI bump (H3-Continuum #24
 * reports masked seams changing after 0.34).
 *
 *   cd app
 *   H3_CAB_DIR=<dir> H3_CAB_BRIEF=walk H3_CAB_LINKS=3 LIVE_RENDER=1 \
 *     node_modules/.bin/vitest run src/lib/workflows/h3-continuation-ab.live.test.ts
 *
 * Per brief: A (the source), C (A's prompt on the continuation seed, no
 * continuation — the floor), then a chain of `H3_CAB_LINKS - 1`
 * continuations. Every continuation renders with its pinned head KEPT, so each
 * seam can be scored against the clip it continues; ffmpeg then trims the head
 * off into output/ and the next link continues from that, exactly as the app's
 * own trim would. Writes `manifest.json` for `h3_cont_ab.py`.
 *
 * On Eros, because that is what the owner renders with — and Eros is
 * turbo-merged, which the motion-context authors say hurts chained audio, so
 * this is the hard case rather than the flattering one.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { minimaxH3Workflow, H3_CONTEXT_FRAMES, H3_FPS } from './minimax-h3'
import { liveEnv } from './live-render'
import type { VideoGenerationParams } from '@/types/video-workflow'
import type { ComfyUIPromptNode } from '@/types/comfyui'

const LIVE = process.env.LIVE_RENDER === '1'
const DIR = process.env.H3_CAB_DIR
const BRIEF = process.env.H3_CAB_BRIEF ?? 'walk'
const LINKS = Number(process.env.H3_CAB_LINKS ?? 3)
const ARMS = ['masked']
const SEED = Number(process.env.LIVE_SEED ?? 20261002)

const BRIEFS: Record<string, string> = {
  walk:
    'integrated_multimodal_description: [Shot 1] Cinematic live-action. A woman in a red coat walks steadily ' +
    'left to right along a wet city pavement at night, neon signs reflecting in the puddles. The ' +
    'camera tracks alongside her at walking pace, holding her in profile. She does not stop.\n\n' +
    'overall_soundscape: Steady footsteps on wet stone at a constant pace, light rain, distant traffic hum.\n\n' +
    'non_diegetic_music: N/A',
  music:
    'integrated_multimodal_description: [Shot 1] Cinematic live-action. A drummer in a small rehearsal room ' +
    'plays a steady four-on-the-floor groove at a constant tempo, sticks striking the snare and ' +
    'hi-hat in strict time. The camera holds a medium shot on the kit. The tempo never changes.\n\n' +
    'overall_soundscape: A tight repeating drum groove at a constant tempo, snare and hi-hat forward, ' +
    'steady kick on every beat. No voices.\n\n' +
    'non_diegetic_music: N/A',
}

// Item 8 asks for longer REFERENCE videos: the same chain, with a character
// picture attached to every link (ref2v keeps precedence over `continue`, so
// the references load in each one). Set H3_CAB_REF to an input/ filename.
BRIEFS.ref =
  'For the target video, the attached references are used as follows: <Picture 1> is fully_preserved.\n\n' +
  'integrated_multimodal_description: [Shot 1] Cinematic live-action. The person from <Picture 1> walks slowly ' +
  'along a sunlit beach promenade from left to right, the camera tracking alongside her in a medium shot. She ' +
  'keeps walking at the same pace and does not stop.\n\n' +
  'overall_soundscape: Waves breaking steadily, light wind, footsteps on wooden boards.\n\n' +
  'non_diegetic_music: N/A'
const REF = process.env.H3_CAB_REF ?? '105619-KREA2__00001_.png'
const refOver: Partial<VideoGenerationParams> =
  BRIEF === 'ref' ? { mode: 'ref2v', refImages: [REF], refImageRoles: ['character'], ref2vTurbo: true, orientation: 'portrait' } : {}

const params = (over: Partial<VideoGenerationParams> = {}): VideoGenerationParams => ({
  prompt: BRIEFS[BRIEF],
  mode: 't2v',
  videoModel: 'minimax-h3',
  h3Checkpoint: 'eros',
  orientation: 'landscape',
  durationSeconds: 5,
  fps: 24,
  seed: SEED,
  vramMode: 'low',
  turbo: false,
  filmGrain: false,
  rife: false,
  upscale: false,
  sharpen: false,
  ...refOver,
  ...over,
})

/** Undo the head trim so the pinned frames stay in the file (see h3-continuation.live.test.ts). */
function keepPinnedHead(wf: Record<string, ComfyUIPromptNode>) {
  const video = Object.values(wf).find((n) => n.class_type === 'CreateVideo')!
  const [imgId] = video.inputs.images as [string, number]
  const [audId] = video.inputs.audio as [string, number]
  expect(wf[imgId].class_type).toBe('ImageFromBatch')
  expect(wf[audId].class_type).toBe('TrimAudioDuration')
  video.inputs.images = wf[imgId].inputs.image
  video.inputs.audio = wf[audId].inputs.audio
  delete wf[imgId]
  delete wf[audId]
  return wf
}

async function render(base: string, wf: unknown, label: string) {
  await fetch(`${base}/free`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  }).catch(() => {})
  const r = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: wf, client_id: 'raccoon-h3-cab' }),
  })
  const body = await r.json()
  expect(r.status, `${label}: ${JSON.stringify(body).slice(0, 900)}`).toBe(200)
  const started = Date.now()
  for (;;) {
    await new Promise((res) => setTimeout(res, 4000))
    const entry = (await (await fetch(`${base}/history/${body.prompt_id}`)).json())?.[body.prompt_id]
    if (!entry) continue
    if (entry.status?.status_str === 'error') throw new Error(`${label}: ${JSON.stringify(entry.status).slice(0, 1200)}`)
    if (entry.status?.completed) {
      const files = Object.values(entry.outputs ?? {}).flatMap((o) =>
        Object.values(o as Record<string, unknown[]>).flat(),
      ) as { filename?: string; subfolder?: string }[]
      const mp4 = files.find((f) => f.filename?.endsWith('.mp4'))!
      console.log(`[h3-cab] ${label}: ${((Date.now() - started) / 1000).toFixed(0)}s -> ${mp4.filename}`)
      return { file: path.join(mp4.subfolder ?? '', mp4.filename!), seconds: (Date.now() - started) / 1000 }
    }
  }
}

describe.skipIf(!LIVE)('H3 continuation seams', () => {
  it(
    'renders a chain per arm with every seam scoreable',
    async () => {
      expect(DIR, 'set H3_CAB_DIR').toBeTruthy()
      expect(BRIEFS[BRIEF], `unknown brief ${BRIEF}`).toBeTruthy()
      const { base, outputDir } = liveEnv()
      const out = path.join(DIR!, BRIEF)
      fs.mkdirSync(out, { recursive: true })
      const sub = `h3-cab/${BRIEF}`
      fs.mkdirSync(path.join(outputDir, sub), { recursive: true })
      const keep = (rel: string, as: string) => fs.copyFileSync(path.join(outputDir, rel), path.join(out, as))

      const a = await render(base, minimaxH3Workflow.buildPrompt(params()), 'A')
      keep(a.file, 'A.mp4')
      const c = await render(base, minimaxH3Workflow.buildPrompt(params({ seed: SEED + 1 })), 'C (control)')
      keep(c.file, 'C.mp4')
      const manifest: Record<string, unknown> = { brief: BRIEF, links: LINKS, A: 'A.mp4', C: 'C.mp4', arms: {} }

      for (const arm of ARMS) {
        const pinned = H3_CONTEXT_FRAMES
        let prev = a.file
        const raws: string[] = []
        const trims: string[] = ['A.mp4']
        const secs: number[] = []
        for (let k = 1; k < LINKS; k++) {
          const wf = keepPinnedHead(
            minimaxH3Workflow.buildPrompt(
              params({ continueFrom: prev.replace(/\\/g, '/'), seed: SEED + 1 + k }),
            ) as unknown as Record<string, ComfyUIPromptNode>,
          )
          expect(Object.values(wf).some((n) => n.class_type === 'RaccoonH3MaskedPrefix')).toBe(true)
          const r = await render(base, wf, `${arm} link ${k + 1}`)
          secs.push(r.seconds)
          const raw = `${arm}-${k + 1}-raw.mp4`
          keep(r.file, raw)
          raws.push(raw)
          // The app's own head trim, done in ffmpeg so the raw file stays scoreable.
          const trimmed = `${sub}/${arm}-${k + 1}.mp4`
          execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(outputDir, r.file),
            '-vf', `select=gte(n\\,${pinned}),setpts=PTS-STARTPTS`,
            '-af', `atrim=start=${pinned / H3_FPS},asetpts=PTS-STARTPTS`,
            '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
            path.join(outputDir, trimmed)])
          keep(trimmed, `${arm}-${k + 1}.mp4`)
          trims.push(`${arm}-${k + 1}.mp4`)
          prev = trimmed
        }
        ;(manifest.arms as Record<string, unknown>)[arm] = { pinned, raws, trims, seconds: secs }
        fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
      }
    },
    4 * 60 * 60_000,
  )
})
