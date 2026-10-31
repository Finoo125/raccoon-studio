/**
 * Live end-to-end for the DEFERRED finishing chain (`params.swapFaces`).
 *
 *   cd app
 *   LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/deferred-swap.live.test.ts
 *
 * The claim under test is not "a graph was built" — the unit tests own that.
 * It is that the delivered files really move:
 *
 *   render with swapFaces  ->  24 fps, native size   (nothing finished it)
 *   swap job with post     ->  36 fps, 1.5x size     (the swap job finished it)
 *
 * Both read off the mp4 with ffprobe, so neither leg can pass by inspecting the
 * graph it just wrote. Needs a real face in the clip, which is why the render is
 * i2v off a portrait rather than t2v.
 *
 * Both legs self-skip rather than fail when a prerequisite is absent, on the
 * same doctrine as `video-face-swap.live.test.ts`: a missing start frame or a
 * machine with no saved face model is not a regression. Point `DEFERRED_START`
 * at any portrait already in ComfyUI's input dir.
 */

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { minimaxH3Workflow, H3_FPS, H3_RIFE_FPS, H3_UPSCALE_SCALE } from './minimax-h3'
import { buildDetectFacesPrompt, buildVideoFaceSwapPrompt } from './video-face-swap'
import type { VideoGenerationParams } from '@/types/video-workflow'

const LIVE = process.env.LIVE_RENDER === '1'
const COMFY = process.env.COMFYUI_URL ?? 'http://localhost:8188'
const OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR ?? ''
const START = process.env.DEFERRED_START ?? 'live_deferred_start.png'
const TIMEOUT = 25 * 60_000

async function post(prompt: unknown) {
  const r = await fetch(`${COMFY}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, client_id: 'raccoon-deferred-live' }),
  })
  return (await r.json()) as Record<string, never>
}

async function waitFor(promptId: string) {
  const deadline = Date.now() + TIMEOUT
  for (;;) {
    if (Date.now() > deadline) throw new Error(`timed out: ${promptId}`)
    await new Promise((r) => setTimeout(r, 2000))
    const hist = await (await fetch(`${COMFY}/history/${promptId}`)).json()
    const entry = hist?.[promptId]
    if (!entry) continue
    if (entry.status?.status_str === 'error') throw new Error(JSON.stringify(entry.status).slice(0, 1500))
    if (entry.status?.completed) {
      return (entry.outputs ?? {}) as Record<
        string,
        { images?: { filename: string; subfolder: string }[]; text?: string[] }
      >
    }
  }
}

/** What the container actually says, not what the graph asked for. */
function probe(rel: string) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,avg_frame_rate,nb_read_packets',
    '-count_packets', '-of', 'json', path.join(OUTPUT_DIR, rel),
  ]).toString()
  const s = JSON.parse(out).streams[0]
  const [num, den] = String(s.avg_frame_rate).split('/').map(Number)
  return { w: s.width as number, h: s.height as number, fps: num / den, frames: Number(s.nb_read_packets) }
}

/** A combo input's options, for asking "is that file on disk?". */
async function comboOf(node: string, field: string): Promise<string[]> {
  const data = await (await fetch(`${COMFY}/object_info/${node}`)).json()
  for (const section of ['required', 'optional'] as const) {
    const input = data?.[node]?.input?.[section]?.[field]
    if (!Array.isArray(input)) continue
    const [head, config] = input
    return (Array.isArray(head) ? head : (config?.options ?? [])) as string[]
  }
  return []
}

const savedPath = (o: { filename: string; subfolder: string }) =>
  (o.subfolder ? `${o.subfolder}/${o.filename}` : o.filename).replace(/\\/g, '/')

describe.skipIf(!LIVE)('deferred finishing chain — live', () => {
  // Shared between the two legs: leg 2 swaps the clip leg 1 rendered.
  const state: { clip?: string; probe?: ReturnType<typeof probe> } = {}

  it('renders unfinished when swapFaces is set', async () => {
    if (!(await comboOf('LoadImage', 'image')).includes(START)) {
      return console.warn(`SKIP: ${START} is not in ComfyUI's input dir — set DEFERRED_START`)
    }
    const params: VideoGenerationParams = {
      prompt: 'she looks into the camera and smiles, then turns her head slightly, soft window light',
      mode: 'i2v',
      inputImage: START,
      orientation: 'portrait',
      durationSeconds: 4,
      fps: H3_FPS,
      seed: 771001,
      vramMode: 'low',
      turbo: 'fast',
      // Every finishing pass ON, and every one of them must be absent from the
      // delivered file. Grain is opt-OUT, so leaving it unset is the honest
      // test: a check that only looked at the ticked passes would miss it.
      rife: true,
      upscale: true,
      sharpen: true,
      swapFaces: true,
    }
    const body = await post(minimaxH3Workflow.buildPrompt(params))
    expect(body.node_errors, JSON.stringify(body.node_errors)).toEqual({})
    const outputs = await waitFor(body.prompt_id as unknown as string)

    const saved = Object.values(outputs).flatMap((o) => o.images ?? []).filter((i) => /\.mp4$/i.test(i.filename))
    expect(saved.length, JSON.stringify(Object.keys(outputs))).toBe(1)
    state.clip = savedPath(saved[0])
    state.probe = probe(state.clip)
    console.log(`[deferred] rendered ${state.clip}`, state.probe)

    // 24 fps is the whole assertion: RIFE was asked for and did not run.
    expect(state.probe.fps).toBeCloseTo(H3_FPS, 1)
    // ...and the frame is the size H3 sampled, not 1.5x it.
    expect(state.probe.w).toBeLessThan(768 * H3_UPSCALE_SCALE)
  }, TIMEOUT)

  it('the swap job finishes it', async () => {
    if (!state.clip || !state.probe) return console.warn('SKIP: leg 1 produced no clip')
    const clip = { file: state.clip, location: 'output' as const }

    const faceModels = (await comboOf('ReActorLoadFaceModel', 'face_model'))
      .filter((n) => n && n.toLowerCase() !== 'none')
    if (faceModels.length === 0) return console.warn('SKIP: no saved face model — build one in Tools')

    const det = await post(buildDetectFacesPrompt({ clip, position: 0.5, namePrefix: 'live_deferred' }))
    const found = (await waitFor(det.prompt_id as unknown as string))['det:detect']?.images ?? []
    expect(found.length, 'no face in the middle frame of the rendered clip').toBeGreaterThan(0)

    // Only ever named when installed: the node raises on a name that is not on
    // disk, which is its contract, not something to work around here.
    const [occluder] = (await comboOf('RaccoonVideoFaceSwap', 'occlusion')).filter((o) => o !== 'off')

    const body = await post(buildVideoFaceSwapPrompt({
      clip,
      characters: [{ reference: found[0].filename, faceModel: faceModels[0] }],
      ...(occluder ? { occluder } : {}),
      // The passes leg 1 held back, exactly as `pendingPost` hands them over.
      post: { rife: true, upscale: true, sharpen: true, filmGrain: undefined },
    }))
    expect(body.node_errors, JSON.stringify(body.node_errors)).toEqual({})
    const outputs = await waitFor(body.prompt_id as unknown as string)

    const report = outputs['vfs:swap']?.text?.[0] ?? ''
    const [, swapped, total] = report.match(/slot 1: (\d+)\/(\d+)/) ?? []
    console.log(`[deferred] ${report}`)
    expect(Number(swapped), `coverage too low: ${report}`).toBeGreaterThan(Number(total) * 0.8)

    const saved = outputs['vfs:save']?.images ?? []
    expect(saved.length).toBe(1)
    const after = probe(savedPath(saved[0]))
    console.log(`[deferred] finished ${savedPath(saved[0])}`, after)

    // The three measurable consequences of the chain having run AFTER the swap.
    expect(after.fps).toBeCloseTo(H3_RIFE_FPS, 1)
    expect(after.w).toBe(Math.round(state.probe.w * H3_UPSCALE_SCALE))
    expect(after.h).toBe(Math.round(state.probe.h * H3_UPSCALE_SCALE))
    // RIFE resamples on real timestamps, so the count follows the fps ratio.
    expect(after.frames / state.probe.frames).toBeGreaterThan(1.4)

    // The swapper counted the frames it was handed. Anything near 1.5x that
    // would mean it ran on interpolated frames, i.e. after RIFE rather than
    // before it — the ordering this whole feature exists to get right.
    expect(Number(total)).toBe(state.probe.frames)
  }, TIMEOUT)
})
