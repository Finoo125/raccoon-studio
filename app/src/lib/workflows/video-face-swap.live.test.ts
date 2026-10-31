/**
 * Live video face-swap checks against a running ComfyUI.
 *
 * Skipped unless `LIVE_RENDER=1`, like the other live tests here.
 *
 *   cd app
 *   LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/video-face-swap.live.test.ts
 *
 * Three legs, needing progressively more of the stack:
 *
 *  - **schema** needs ComfyUI and nothing else. It POSTs both graphs pointed at
 *    files that do not exist and asserts every complaint is `value_not_in_list`
 *    — "that file is not on disk" — and nothing else. Anything else means a node
 *    or input was renamed, a link dangles, or a required input is missing, which
 *    is the class of breakage a ComfyUI bump or a pack edit causes. Runnable
 *    before any model is downloaded.
 *  - **detect** needs a clip in the output dir and buffalo_l.
 *  - **swap** additionally needs a saved ReActor face model. Both self-skip with
 *    a clear message rather than failing, so a missing prerequisite does not
 *    read as a regression.
 *
 * `SWAP_CLIP` overrides the clip (output-dir-relative). Otherwise the newest mp4
 * under the output dir is used, so the harness keeps working as clips come and go.
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  buildDetectFacesPrompt,
  buildVideoFaceSwapPrompt,
  type SwapCharacter,
  type VideoSource,
} from './video-face-swap'

const LIVE = process.env.LIVE_RENDER === '1'
const COMFY = process.env.COMFYUI_URL ?? 'http://localhost:8188'
const OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR ?? ''
const SWAP_TIMEOUT_MS = 20 * 60_000

interface NodeError { errors?: { type?: string }[] }

async function post(prompt: unknown) {
  const r = await fetch(`${COMFY}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, client_id: 'raccoon-swap-live' }),
  })
  return { status: r.status, body: (await r.json()) as Record<string, unknown> }
}

async function waitFor(promptId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms`)
    await new Promise((r) => setTimeout(r, 2000))
    const hist = await (await fetch(`${COMFY}/history/${promptId}`)).json()
    const entry = hist?.[promptId]
    if (!entry) continue
    if (entry.status?.status_str === 'error') {
      throw new Error(JSON.stringify(entry.status).slice(0, 1200))
    }
    if (entry.status?.completed) {
      return (entry.outputs ?? {}) as Record<string, { images?: { filename: string }[]; text?: string[] }>
    }
  }
}

/** Newest mp4 under the output dir, output-relative. Null when there is none. */
function newestClip(): string | null {
  if (process.env.SWAP_CLIP) return process.env.SWAP_CLIP
  if (!OUTPUT_DIR || !fs.existsSync(OUTPUT_DIR)) return null
  const found: { rel: string; mtime: number }[] = []
  const walk = (dir: string, depth: number) => {
    if (depth < 0) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, depth - 1)
      else if (/\.mp4$/i.test(e.name)) {
        found.push({ rel: path.relative(OUTPUT_DIR, p).split(path.sep).join('/'), mtime: fs.statSync(p).mtimeMs })
      }
    }
  }
  walk(path.resolve(OUTPUT_DIR), 5)
  found.sort((a, b) => b.mtime - a.mtime)
  return found[0]?.rel ?? null
}

async function comboOf(node: string, field: string): Promise<string[]> {
  const data = await (await fetch(`${COMFY}/object_info/${node}`)).json()
  const input = data?.[node]?.input?.required?.[field]
  if (!Array.isArray(input)) return []
  const [head, config] = input
  return (Array.isArray(head) ? head : (config?.options ?? [])) as string[]
}

const CLIP: VideoSource = { file: newestClip() ?? 'missing.mp4', location: 'output' }

describe.skipIf(!LIVE)('video face swap — live', () => {
  it('both graphs are structurally valid against this ComfyUI', async () => {
    // Pointed at files that do not exist on purpose: the only complaints allowed
    // are "not in the list". A renamed node or input shows up as something else.
    const graphs = [
      buildDetectFacesPrompt({ clip: { file: 'nope.mp4', location: 'output' }, position: 0.5, namePrefix: 'schema' }),
      buildVideoFaceSwapPrompt({
        clip: { file: 'nope.mp4', location: 'output' },
        characters: [{ reference: 'nope.png', faceModel: 'nope.safetensors' }],
        occluder: 'xseg_1.onnx',
      }),
    ]
    for (const graph of graphs) {
      const { body } = await post(graph)
      // Two shapes of "that file is not on disk", both fine here: a combo input
      // reports `value_not_in_list`, while core LoadVideo runs its own check
      // (it stats the file for a fingerprint) and reports
      // `custom_validation_failed`. Everything else — a renamed node or input, a
      // dangling link, a required input the builder forgot — is a real break.
      const MISSING_FILE = ['value_not_in_list', 'custom_validation_failed']
      const errs = Object.entries((body.node_errors ?? {}) as Record<string, NodeError>)
      for (const [nodeId, err] of errs) {
        for (const e of err.errors ?? []) {
          expect(MISSING_FILE, `${nodeId}: ${e.type}`).toContain(e.type)
        }
      }
      // ComfyUI wraps any set of node_errors in one top-level
      // `prompt_outputs_failed_validation`, so its presence here is expected —
      // the graph names missing files on purpose. What matters is that it is
      // *that* error and not another: a graph ComfyUI cannot even parse fails
      // with `invalid_prompt`, and a renamed node shows up there rather than in
      // node_errors.
      const top = (body.error ?? null) as { type?: string } | null
      expect(top?.type ?? 'prompt_outputs_failed_validation', JSON.stringify(top))
        .toBe('prompt_outputs_failed_validation')
    }
  }, 60_000)

  it('finds faces in a real clip and writes reference crops', async () => {
    const clip = newestClip()
    if (!clip) return console.warn('SKIP: no mp4 in COMFYUI_OUTPUT_DIR')

    const { body } = await post(buildDetectFacesPrompt({
      clip: CLIP, position: 0.5, namePrefix: 'live_swap_ref',
    }))
    const outputs = await waitFor(body.prompt_id as string, 120_000)
    const images = outputs['det:detect']?.images ?? []
    expect(images.length).toBeGreaterThan(0)
    // The crops land in ComfyUI's INPUT dir, which is what lets the swap graph
    // read them back through a plain LoadImage with no annotation.
    for (const i of images) expect(i.filename).toMatch(/^live_swap_ref_\d+\.png$/)
  }, 180_000)

  it('swaps a face across the clip and reports its coverage', async () => {
    const clip = newestClip()
    if (!clip) return console.warn('SKIP: no mp4 in COMFYUI_OUTPUT_DIR')
    const faceModels = (await comboOf('ReActorLoadFaceModel', 'face_model'))
      .filter((n) => n && n.toLowerCase() !== 'none')
    if (faceModels.length === 0) return console.warn('SKIP: no saved face model — build one in Tools')

    const detect = await post(buildDetectFacesPrompt({
      clip: CLIP, position: 0.5, namePrefix: 'live_swap_ref',
    }))
    const found = (await waitFor(detect.body.prompt_id as string, 120_000))['det:detect']?.images ?? []
    if (found.length === 0) return console.warn('SKIP: no face in the middle frame of this clip')

    const characters: SwapCharacter[] = [{ reference: found[0].filename, faceModel: faceModels[0] }]
    const occluders = (await comboOf('RaccoonVideoFaceSwap', 'occlusion')).filter((o) => o !== 'off')
    const { body } = await post(buildVideoFaceSwapPrompt({
      clip: CLIP,
      characters,
      // Only names the occluder when it is actually installed — the node raises
      // otherwise, which is the behaviour, not something to work around here.
      ...(occluders.length ? { occluder: occluders[0] } : {}),
    }))
    expect(body.node_errors, JSON.stringify(body.node_errors)).toEqual({})

    const outputs = await waitFor(body.prompt_id as string, SWAP_TIMEOUT_MS)

    // The coverage report is the whole point of the node being an OUTPUT_NODE:
    // without it, a face that turned away for two seconds and a swap that never
    // ran look identical from the outside.
    const report = outputs['vfs:swap']?.text?.[0] ?? ''
    expect(report).toMatch(/\d+ frames/)
    const [, swapped, total] = report.match(/slot 1: (\d+)\/(\d+)/) ?? []
    // 0.8, not 0.5. Half a clip swapped is not "partly working" — it reads as
    // the face flickering between two identities, which is worse than leaving it
    // alone, and it is exactly what a static reference produced before
    // `assign_faces` learned to track a character frame to frame.
    expect(Number(swapped), `coverage too low: ${report}`).toBeGreaterThan(Number(total) * 0.8)

    const saved = outputs['vfs:save']?.images ?? []
    expect(saved.length).toBe(1)
    expect(saved[0].filename).toMatch(/\.mp4$/)
    console.log(`swapped clip: ${saved[0].filename} — ${report}`)
  }, SWAP_TIMEOUT_MS + 300_000)

  // "Swap faces first" (a `post` present) turns on the node's gate. Needs a clip in
  // ComfyUI's INPUT dir where the head turns away: SWAP_GATE_CLIP=<input-relative>.
  // Swaps the face with itself (its own crop as the replacement), so no face model
  // is needed; the check is the report, and the clip is deleted again.
  it('Swap faces first keeps the original face where the head turns away', async () => {
    const file = process.env.SWAP_GATE_CLIP
    if (!file) return console.warn('SKIP: set SWAP_GATE_CLIP to a clip in ComfyUI input/ with a turned head')
    const clip: VideoSource = { file, location: 'input' }
    const detect = await post(buildDetectFacesPrompt({ clip, position: 0.1, namePrefix: 'live_gate_ref' }))
    const found = (await waitFor(detect.body.prompt_id as string, 120_000))['det:detect']?.images ?? []
    expect(found.length, 'no face 10% into the clip').toBeGreaterThan(0)

    const graph = buildVideoFaceSwapPrompt({
      clip, characters: [{ reference: found[0].filename, sourceImage: found[0].filename }], post: {},
    })
    expect(graph['vfs:swap'].inputs.gate).toBe(true)
    const { body } = await post(graph)
    expect(body.node_errors, JSON.stringify(body.node_errors)).toEqual({})
    const outputs = await waitFor(body.prompt_id as string, SWAP_TIMEOUT_MS)
    const report = outputs['vfs:swap']?.text?.[0] ?? ''
    console.log(`gate: ${report}`)
    expect(Number(report.match(/original kept on (\d+)/)?.[1] ?? 0), report).toBeGreaterThan(0)
    expect(Number(report.match(/slot 1: (\d+)\//)?.[1] ?? 0), report).toBeGreaterThan(0)

    const saved = outputs['vfs:save']?.images ?? []
    expect(saved.length).toBe(1)
    if (OUTPUT_DIR) {
      const s = saved[0] as { filename: string; subfolder?: string }
      fs.rmSync(path.join(OUTPUT_DIR, s.subfolder ?? '', s.filename), { force: true })
    }
  }, SWAP_TIMEOUT_MS + 300_000)
})
