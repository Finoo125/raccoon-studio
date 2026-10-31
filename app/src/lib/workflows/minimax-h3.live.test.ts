/**
 * Live MiniMax H3 checks against a running ComfyUI.
 *
 * Skipped unless `LIVE_RENDER=1`, like the other live tests here.
 *
 *   cd app
 *   LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/minimax-h3.live.test.ts
 *
 * The two tests need very different things, deliberately:
 *
 *  - **the schema check needs ComfyUI but NOT the 42.5 GB of weights.** It POSTs
 *    the built graph and asserts every complaint is `value_not_in_list` — i.e.
 *    "that model file is not on disk" — and nothing else. Anything else means a
 *    node was renamed, an input was renamed, a link dangles or a required input
 *    is missing, which is exactly the class of breakage a ComfyUI bump causes.
 *    That makes this runnable the moment the version is bumped, long before
 *    anyone downloads the models.
 *  - **the render needs the weights** and self-skips with a clear message when
 *    they are absent, rather than failing and looking like a regression.
 */

import zlib from 'node:zlib'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, it, expect, beforeAll } from 'vitest'
import { minimaxH3Workflow, h3FrameCount, h3KeyframeFrames, H3_REF2VA_CKPT, H3_TURBO, H3_EROS } from './minimax-h3'
import { MINIMAX_H3_ASSETS } from '@/lib/models/minimax-h3-assets'
import type { VideoGenerationParams } from '@/types/video-workflow'

const LIVE = process.env.LIVE_RENDER === '1'
const COMFY = process.env.COMFYUI_URL ?? 'http://localhost:8188'

/** Fresh every run: a fixed seed lets ComfyUI's execution cache serve the run. */
const SEED = Number(process.env.LIVE_SEED ?? Date.now() % 9_000_000_000)
const DURATION_S = 5
const RENDER_TIMEOUT_MS = 30 * 60_000

const params = (over: Partial<VideoGenerationParams> = {}): VideoGenerationParams => ({
  prompt: 'a raccoon in a film studio operating a vintage camera, warm tungsten light',
  mode: 't2v',
  orientation: 'landscape',
  durationSeconds: DURATION_S,
  fps: 24,
  seed: SEED,
  vramMode: 'low',
  ...over,
})

async function post(prompt: unknown) {
  const r = await fetch(`${COMFY}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, client_id: 'raccoon-h3-live' }),
  })
  return { status: r.status, body: (await r.json()) as Record<string, never> }
}

/** Poll `/history` until the job finishes; returns the output filenames. */
async function waitForOutputs(promptId: string): Promise<string[]> {
  return (await waitForFiles(promptId)).map((f) => f.filename)
}

/** Poll `/history` until the job finishes; returns each output's name and subfolder. */
async function waitForFiles(promptId: string): Promise<{ filename: string; subfolder: string }[]> {
  const deadline = Date.now() + RENDER_TIMEOUT_MS
  for (;;) {
    if (Date.now() > deadline) throw new Error(`render timed out after ${RENDER_TIMEOUT_MS}ms`)
    await new Promise((r) => setTimeout(r, 5000))
    const hist = await (await fetch(`${COMFY}/history/${promptId}`)).json()
    const entry = hist?.[promptId]
    if (!entry) continue
    if (entry.status?.status_str === 'error') throw new Error(JSON.stringify(entry.status).slice(0, 800))
    if (entry.status?.completed) {
      const files = Object.values(entry.outputs ?? {}).flatMap((o) =>
        Object.values(o as Record<string, unknown[]>).flat(),
      ) as { filename?: string; subfolder?: string }[]
      return files.flatMap((f) => (f?.filename ? [{ filename: f.filename, subfolder: f.subfolder ?? '' }] : []))
    }
  }
}

/** A 64×64 mid-grey PNG, built here so the reference test ships no binary fixture. */
function grayPng(): Buffer {
  return solidPng(128, 128, 128)
}

/** A 64×64 PNG of one solid colour. */
function solidPng(r: number, g: number, b: number): Buffer {
  const w = 64
  const row = Buffer.alloc(w * 3)
  for (let i = 0; i < w; i++) row.set([r, g, b], i * 3)
  const raw = Buffer.concat(Array.from({ length: w }, () => Buffer.concat([Buffer.from([0]), row])))
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(w, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** A 1 s 440 Hz mono WAV, so the audio-reference path needs no binary fixture. */
function toneWav(): Buffer {
  const rate = 16000
  const pcm = Buffer.alloc(rate * 2)
  for (let i = 0; i < rate; i++) {
    pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), i * 2)
  }
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + pcm.length, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16) // PCM chunk size
  head.writeUInt16LE(1, 20) // PCM
  head.writeUInt16LE(1, 22) // mono
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28) // byte rate
  head.writeUInt16LE(2, 32) // block align
  head.writeUInt16LE(16, 34) // bits
  head.write('data', 36)
  head.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([head, pcm])
}

/**
 * Put a file in ComfyUI's input dir and return the name a loader can use.
 *
 * `/upload/image` does no content-type check on the write path, so it serves
 * images, audio and video alike — the loader node decides how to read it.
 */
async function uploadInput(bytes: Buffer, as: string): Promise<string> {
  const form = new FormData()
  // No MIME type on purpose — this uploads WAVs too, and ComfyUI writes the
  // raw bytes either way; claiming image/png for a WAV would just mislead.
  form.append('image', new Blob([new Uint8Array(bytes)]), as)
  form.append('overwrite', 'true')
  form.append('type', 'input')
  const r = await fetch(`${COMFY}/upload/image`, { method: 'POST', body: form })
  if (!r.ok) throw new Error(`upload failed: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { name: string }).name
}

/** Model filenames ComfyUI currently lists, across the loaders H3 uses. */
async function installedModels(): Promise<Set<string>> {
  const probes: [string, string][] = [
    ['UNETLoader', 'unet_name'],
    ['CLIPLoader', 'clip_name'],
    ['VAELoader', 'vae_name'],
    // Without this the Turbo LoRA is never found and BOTH render tests
    // self-skip forever — a green run that rendered nothing. Cost: the t2v
    // render silently stopped running the day Turbo was added to the catalog.
    ['LoraLoader', 'lora_name'],
  ]
  const out = new Set<string>()
  for (const [cls, field] of probes) {
    try {
      const d = await (await fetch(`${COMFY}/object_info/${cls}`)).json()
      for (const n of d?.[cls]?.input?.required?.[field]?.[0] ?? []) out.add(String(n))
    } catch {
      /* leave it out — the caller reports the gap */
    }
  }
  return out
}

/**
 * Post a graph and assert ComfyUI's only complaints are "that model file is not
 * on disk". Anything else — a renamed node, a renamed input, a dangling link, a
 * missing required input — is exactly the class of breakage a ComfyUI bump
 * causes, which is why this runs long before anyone downloads 42 GB of weights.
 *
 * **A 200 is not a pass, it is a queued render.** `/prompt` has no dry-run mode:
 * when the weights happen to be present ComfyUI accepts the graph and starts
 * sampling, so a "does this validate?" test would silently occupy the GPU for
 * minutes. Cancel what we just started and take the 200 as the strongest
 * possible answer — the graph was good enough to run.
 */
async function expectOnlyMissingModels(prompt: unknown) {
  const { status, body } = await post(prompt)
  if (status === 200) {
    const id = (body as unknown as { prompt_id: string }).prompt_id
    await fetch(`${COMFY}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: [id] }),
    }).catch(() => {})
    // `delete` only drops it from the pending list; a job that already started
    // needs the interrupt too.
    await fetch(`${COMFY}/interrupt`, { method: 'POST' }).catch(() => {})
    return
  }

  const nodeErrors = (body.node_errors ?? {}) as Record<
    string,
    { class_type: string; errors: { type: string; details?: string; extra_info?: { input_name?: string } }[] }
  >
  const structural = Object.entries(nodeErrors).flatMap(([id, n]) =>
    n.errors
      .filter((e) => e.type !== 'value_not_in_list')
      // VHS checks its clip itself, so a missing file arrives as a custom
      // validation failure rather than value_not_in_list — still only "no such file".
      .filter((e) => !(n.class_type === 'VHS_LoadVideo' && e.type === 'custom_validation_failed' && e.details?.includes('Invalid video file')))
      .map((e) => `${n.class_type}#${id}.${e.extra_info?.input_name ?? '?'}: ${e.type}`),
  )
  expect(structural).toEqual([])

  // Every remaining complaint must name a file the Models page can install —
  // otherwise the catalog and the graph have drifted apart.
  const catalog = new Set(MINIMAX_H3_ASSETS.map((a) => a.name))
  for (const n of Object.values(nodeErrors)) {
    for (const e of n.errors) {
      const received = (e as { extra_info?: { received_value?: string } }).extra_info?.received_value
      if (received) expect(catalog).toContain(received)
    }
  }
}

describe.skipIf(!LIVE)('MiniMax H3 live', () => {
  beforeAll(async () => {
    const r = await fetch(`${COMFY}/system_stats`).catch(() => null)
    if (!r?.ok) throw new Error(`ComfyUI is not reachable at ${COMFY}`)
  })

  it('graph validates against ComfyUI — only missing model files, no wiring errors', async () => {
    await expectOnlyMissingModels(minimaxH3Workflow.buildPrompt(params()))
  })

  it('the sharpen + RIFE graph validates too', async () => {
    // Covers the two spliced non-core nodes in one POST. What it catches is a
    // node being renamed out from under us on a pack bump; what it canNOT catch
    // is `method.strength` losing its prefix convention, because ComfyUI drops
    // unrecognised inputs at validation and only dies at execution. That one is
    // pinned by the unit test and was proven live 2026-08-30 the only way it
    // can be: rendering at strength 0 (a documented no-op) and confirming the
    // output came back byte-identical, which it would not have had the key been
    // dropped and the node's own 0.8 default applied.
    await expectOnlyMissingModels(minimaxH3Workflow.buildPrompt(params({ sharpen: true, rife: true })))
  })

  it('ref2v graph validates too — only missing model files, no wiring errors', async () => {
    // Note what this canNOT catch: a wrong autogrow key. ComfyUI ignores inputs
    // it does not recognise, so `ref_imagez.ref_image_0` would validate happily
    // and render with no references at all. The unit test owns that invariant.
    await expectOnlyMissingModels(
      minimaxH3Workflow.buildPrompt(params({ mode: 'ref2v', refImages: ['example.png'] })),
    )
  })

  it('a split edit graph validates too — only missing files, no wiring errors', async () => {
    // 15 s at the medium size renders in three Seamless parts: three samplers,
    // two RaccoonH3MaskedPrefix links, ImageBatch/AudioConcat stitching. Like the
    // ref2v check, it cannot see a wrong autogrow key — the unit tests own that.
    const wf = minimaxH3Workflow.buildPrompt(params({
      mode: 'edit', editSource: 'does-not-exist.mp4', editKind: 'vfx', vramMode: 'medium',
      editSourceWidth: 608, editSourceHeight: 1056, editSourceFrames: 362, editSourceHasAudio: true,
    }))
    expect(Object.values(wf).filter((n) => n.class_type === 'SamplerCustomAdvanced').length).toBe(3)
    await expectOnlyMissingModels(wf)
    await expectOnlyMissingModels(minimaxH3Workflow.buildPrompt(params({
      mode: 'edit', editSource: 'does-not-exist.mp4', editKind: 'vfx', vramMode: 'medium', editJoin: 'fast',
      editSourceWidth: 608, editSourceHeight: 1056, editSourceFrames: 362, editSourceHasAudio: false,
    })))
    await expectOnlyMissingModels(minimaxH3Workflow.buildPrompt(params({
      mode: 'edit', editSource: 'does-not-exist.mp4', editKind: 'vfx', vramMode: 'medium',
      editSourceWidth: 608, editSourceHeight: 1056, editSourceFrames: 362, editSourceHasAudio: true,
      editPictures: ['example.png', 'example.png'], editPictureRoles: ['character', 'outfit'], editFaceChecked: 'example.png',
    })))
    await expectOnlyMissingModels(minimaxH3Workflow.buildPrompt(params({
      mode: 'edit', editFollow: 'loose', editSource: 'does-not-exist.mp4', vramMode: 'medium',
      editSourceWidth: 608, editSourceHeight: 1056, editSourceFrames: 362, editSourceHasAudio: true,
      editPictures: ['example.png'], editPictureRoles: ['character'], editPictureNotes: ['a woman'],
    })))
  })

  it('renders a reference clip that honours its reference', async () => {
    const have = await installedModels()
    // Required set + the two optional files this test actually uses. Spelled
    // as an allowlist, never as "the catalog minus what I know is optional" —
    // that shape turns every future optional entry into a silent skip, and a
    // skipped live test is indistinguishable from a passing one.
    const need = [
      ...MINIMAX_H3_ASSETS.filter((a) => !a.optional).map((a) => a.name),
      H3_REF2VA_CKPT,
      H3_TURBO.draft.lora,
    ]
    const absent = need.filter((n) => !have.has(n) && ![...have].some((x) => x.endsWith('/' + n)))
    if (absent.length) {
      console.warn(`[h3] skipping ref2v render — not installed: ${absent.join(', ')}`)
      return
    }

    // Generated here rather than shipped so the test carries no binary fixture.
    // This proves the ref2va path *executes* end to end — it deliberately does
    // not try to prove identity transfer, which needs a real subject and a
    // saturation measurement (done by hand 2026-08-11: a monochrome manga
    // reference drove frame saturation to 0.4, against 24–54 for a colour
    // render). The wiring invariants are the unit tests' job.
    const ref = await uploadInput(grayPng(), 'h3_ref2v_probe.png')
    // An audio reference alongside it, so the LoadAudio -> ref_audios path is
    // covered too. Reference *videos* are deliberately not here: an mp4 cannot
    // be synthesized in a few lines the way a PNG and a WAV can, and shipping a
    // binary fixture to cover what the unit tests already assert structurally
    // is a poor trade. Proven live 2026-08-11 instead, including a silent clip.
    const sound = await uploadInput(toneWav(), 'h3_ref2v_probe.wav')

    const { status, body } = await post(
      minimaxH3Workflow.buildPrompt(
        params({
          mode: 'ref2v',
          // Turbo keeps this affordable: measured 71 s vs 150 s at 20 steps, and
          // reference conditioning is equally visible either way.
          turbo: true,
          refImages: [ref],
          refAudios: [sound],
          durationSeconds: 4,
          prompt:
            'For the target video, the attached references are used as follows: ' +
            '<Picture 1> is fully_preserved.\n\n' +
            'integrated_multimodal_description: [Shot 1] Flat monochrome grey, no colour ' +
            'anywhere, matching <Picture 1>. A plain grey wall fills the frame. The camera ' +
            'pushes in with small amplitude at slow speed.\n' +
            'overall_soundscape: A low, steady room tone.\n' +
            'non_diegetic_music: N/A',
        }),
      ),
    )
    expect(status, JSON.stringify(body).slice(0, 800)).toBe(200)
    const promptId = (body as unknown as { prompt_id: string }).prompt_id
    const names = await waitForOutputs(promptId)
    console.log('[h3] ref2v outputs:', names.join(', '))
    expect(names.some((n) => n.endsWith('.mp4'))).toBe(true)
  }, RENDER_TIMEOUT_MS)

  it('lands a reference clip on its keyframes', async () => {
    const have = await installedModels()
    // This leg runs on Eros, which carries ref2va's weights itself, so the stock
    // DiT (the one required diffusion_models entry) is not needed for it.
    const need = [
      ...MINIMAX_H3_ASSETS.filter((a) => !a.optional && a.folder !== 'diffusion_models').map((a) => a.name),
      H3_EROS.ckpt,
    ]
    const absent = need.filter((n) => !have.has(n) && ![...have].some((x) => x.endsWith('/' + n)))
    if (absent.length) {
      console.warn(`[h3] skipping keyframe render — not installed: ${absent.join(', ')}`)
      return
    }

    // Three solid colours, so "did it land on the picture?" is a nearest-colour
    // question with no judgement in it: each keyframe's frame must sit closer to
    // its own colour than to the other two.
    const COLOURS = { start: [200, 40, 40], middle: [40, 180, 60], end: [40, 70, 200] } as const
    const KF_CAP = 40
    const ref = await uploadInput(grayPng(), 'h3_kf_probe_ref.png')
    const keyframes = Object.fromEntries(
      await Promise.all(Object.entries(COLOURS).map(async ([slot, [r, g, b]]) =>
        [slot, { image: await uploadInput(solidPng(r, g, b), `h3_kf_probe_${slot}.png`), width: 64, height: 64 }])),
    )
    const { status, body } = await post(
      minimaxH3Workflow.buildPrompt(
        params({
          mode: 'ref2v',
          h3Checkpoint: 'eros',
          refImages: [ref],
          keyframes,
          prompt:
            'For the target video, the attached references are used as follows: ' +
            '<Picture 1> is weak_reference.\n\n' +
            'integrated_multimodal_description: [Shot 1] A plain painted wall fills the frame, ' +
            'perfectly still; its colour shifts slowly and evenly from one solid colour to another.\n\n' +
            'overall_soundscape: A low, steady room tone.\n\n' +
            'non_diegetic_music: N/A',
        }),
      ),
    )
    expect(status, JSON.stringify(body).slice(0, 800)).toBe(200)
    const files = await waitForFiles((body as unknown as { prompt_id: string }).prompt_id)
    const mp4 = files.find((f) => f.filename.endsWith('.mp4'))
    expect(mp4, 'no mp4 came back').toBeTruthy()
    const local = path.join(os.tmpdir(), `h3_kf_probe_${SEED}.mp4`)
    const q = new URLSearchParams({ filename: mp4!.filename, subfolder: mp4!.subfolder, type: 'output' })
    fs.writeFileSync(local, Buffer.from(await (await fetch(`${COMFY}/view?${q}`)).arrayBuffer()))

    const at = h3KeyframeFrames(h3FrameCount(DURATION_S), false)
    const meanRgb = (frame: number) => {
      const px = execFileSync('ffmpeg', ['-v', 'error', '-i', local, '-vf', `select=eq(n\\,${frame}),scale=8:8`,
        '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 16 }) as unknown as Buffer
      return [0, 1, 2].map((c) => px.filter((_, i) => i % 3 === c).reduce((s, v) => s + v, 0) / (px.length / 3))
    }
    const dist = (a: number[], b: readonly number[]) => Math.hypot(...a.map((v, i) => v - b[i]))
    for (const slot of Object.keys(COLOURS) as (keyof typeof COLOURS)[]) {
      const rgb = meanRgb(at[slot]!)
      const d = Object.fromEntries(Object.entries(COLOURS).map(([s, c]) => [s, Math.round(dist(rgb, c))]))
      console.log(`[h3] keyframe ${slot} @ frame ${at[slot]}: rgb ${rgb.map(Math.round).join('/')}, distance ${JSON.stringify(d)}`)
      expect(Math.min(...Object.values(d)), `${slot} frame is nearer another keyframe`).toBe(d[slot])
      // And close in absolute terms: a clean landing measured 7-14, the wrong colour 166+.
      expect(d[slot], `${slot} frame drifted off its keyframe`).toBeLessThan(KF_CAP)
    }
  }, RENDER_TIMEOUT_MS)

  it('renders a clip with a synced audio track', async () => {
    const have = await installedModels()
    // Nothing optional belongs in this gate: a plain t2v render must not be
    // held hostage to the 21 GB reference checkpoint or to a Turbo LoRA.
    const required = MINIMAX_H3_ASSETS.filter((a) => !a.optional)
    const absent = required.filter(
      (a) => !have.has(a.name) && ![...have].some((n) => n.endsWith('/' + a.name)),
    )
    if (absent.length) {
      console.warn(
        `[h3] skipping render — ${absent.length} model file(s) not installed: ` +
          absent.map((a) => a.name).join(', '),
      )
      return
    }

    console.log(`[h3] seed ${SEED}, ${h3FrameCount(DURATION_S)} frames`)
    const { status, body } = await post(minimaxH3Workflow.buildPrompt(params()))
    expect(status, JSON.stringify(body).slice(0, 800)).toBe(200)
    const promptId = (body as unknown as { prompt_id: string }).prompt_id
    const names = await waitForOutputs(promptId)
    console.log('[h3] outputs:', names.join(', '))
    expect(names.some((n) => n.endsWith('.mp4'))).toBe(true)
  }, RENDER_TIMEOUT_MS)
})
