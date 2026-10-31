/**
 * Live A/B for the face-swap chain, against a running ComfyUI.
 *
 *   cd app
 *   LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/face-swap-ab.live.test.ts
 *
 * That renders ONE seed. For a multi-seed result, restart ComfyUI between seeds
 * and merge the per-seed `results.json` — see the poisoning note below for why:
 *
 *   for SEED in 20260905 771 4242; do
 *     <restart ComfyUI, wait for /system_stats>
 *     SWAP_AB_SEEDS=$SEED SWAP_AB_DIR=/tmp/swap-$SEED  *       LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/face-swap-ab.live.test.ts
 *   done
 *
 * Answers three questions with numbers instead of eyeballing:
 *
 *  1. **Which swap model has the best likeness?** inswapper_128 (the shipped
 *     default) vs hyperswap_1c_256 (the best of the previous set) vs
 *     alphaface_256 (FaceFusion 3.9.0's, new here).
 *  2. **What does the identity dial actually do?** The same model at its
 *     extremes, 0.0 and 1.0, against the 0.5 no-op.
 *  3. **Was moving the detailer after the swap right?** The old pipeline
 *     (detailer @0.25, then the swap paints over it) vs the new one (swap, then
 *     detailer @0.15) vs no detailer at all as the identity control.
 *
 * The metric is ArcFace cosine similarity between the SOURCE photo and the face
 * in the render — the same recognizer the swapper itself conditions on, so it
 * measures the thing the feature claims to deliver. Self-check on the reference
 * photo against itself is 1.0, and against a different person -0.09, so the
 * scale is calibrated. Sharpness is measured on the FACE CROP, never the whole
 * frame: this project has already been misled once by whole-frame Laplacian
 * energy, which moves with background bokeh.
 *
 * ⚠️⚠️ **ONE ComfyUI PROCESS PER SEED. This is not optional.**
 *
 * Isolated 2026-09-05 on ComfyUI v0.34.2: **any face-swap render on Krea2 Turbo
 * poisons Krea2 for the rest of the process.** Every subsequent Krea2 render
 * comes back a pure black frame — `status_str: "success"`, a ~5 KB PNG — and it
 * never recovers. The evidence, each leg a single variable:
 *
 *   - Three plain Krea2 txt2img renders back to back in a fresh process: all
 *     clean (~1.1 MB). So Krea2 alone is fine.
 *   - Render WITH the swap chain, then a plain Krea2 render with **no swap in
 *     the graph at all**: black. And the one after that: black.
 *   - Triggered by **ReActor's own node too**, not just the vendored one, with
 *     plain `inswapper_128`. So it is neither this pack nor AlphaFace.
 *   - `POST /free {"unload_models": true, "free_memory": true}` does **not**
 *     recover it.
 *   - An intervening healthy SDXL render does not recover it, and SDXL itself
 *     keeps rendering fine — so it is Krea2-specific, not global GPU state.
 *   - Reproduces with `RACCOON_DYNAMIC_VRAM=0`, so it is **not** the documented
 *     DynamicVRAM corruption (which is intermittent and colourful; this is
 *     deterministic and black).
 *   - Only a ComfyUI restart clears it.
 *
 * What saves the measurement is that legs *within* one seed are fine: they share
 * a single base render out of ComfyUI's execution cache, so only the swap
 * re-executes. It is sampling a NEW base image after a swap that fails. Hence
 * one process per seed — see the driver in the file header comment above.
 *
 * How it presents, because this is what costs the time: the swap node aborts
 * with "no target face found in any frame" (there is genuinely no face in a
 * black image), so it reads as a broken face swap rather than a poisoned model,
 * and every remaining leg fails identically. Two diagnostics settle it in
 * seconds — the output PNG's **file size**, and that it never recovers.
 *
 * Consequences baked in below:
 *
 *   - **Legs run leg-major, not seed-major**, ordered least- to most-corruption-
 *     prone, so the model comparison finishes before the detailer legs (a second
 *     diffusion pass) run.
 *   - **A poison guard aborts the sweep** after `POISON_STREAK` consecutive
 *     failures instead of burning the matrix on black frames.
 *   - **No `POST /free` between legs** — it does not help, and it costs a full
 *     checkpoint reload plus the shared cached base the comparison relies on.
 *   - **Corrupted runs are dropped, not averaged.** Identity collapsing toward
 *     zero while face sharpness explodes past 5x the median is the signature;
 *     note the project's whole-frame channel-spread metric does NOT see a
 *     face-localized corruption (it read 15.2 against 16.4 for clean renders,
 *     and face-crop spread read 35.5 vs 45.5 — the wrong direction).
 *
 * Evidence the measurement itself is stable: the `model-inswapper_128` leg
 * scored 0.8574 in three independent sweeps, on three separate ComfyUI
 * processes.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, it, expect, beforeAll } from 'vitest'
import { krea2TurboWorkflow } from './krea2'
import { sdxlWorkflow } from './sdxl'
import { appendFaceSwap } from './face-swap'
import type { ComfyUIPrompt } from '@/types/comfyui'
import type { GenerationParams } from '@/types/workflow'

const LIVE = process.env.LIVE_RENDER === '1'
const OUT_DIR = process.env.SWAP_AB_DIR ?? path.join(os.tmpdir(), 'raccoon-swap-ab')

/** Source face, already uploaded to ComfyUI's input dir. */
const SOURCE_FACE = process.env.SWAP_AB_FACE ?? 'swap-live-face.png'

/**
 * Several seeds, because the corruption above is non-deterministic and because
 * one render is a sample, not a measurement. Each seed is its own base image;
 * legs are compared within a seed and then averaged.
 */
const SEEDS = (process.env.SWAP_AB_SEEDS ?? '20260905,771,4242').split(',').map(Number)

/**
 * SDXL's stock checkpoint is not installed on every dev box. Point this at any
 * installed SDXL-family file to render the SDXL legs; they self-skip otherwise
 * rather than failing the run.
 */
const SDXL_CKPT = process.env.SWAP_AB_SDXL_CKPT ?? 'sd_xl_base_1.0.safetensors'

/**
 * Comma-separated leg-name prefixes to run, or empty for all. The Krea2
 * poisoning means a process gets a limited render budget, so being able to spend
 * it on the legs you actually care about ("order-", "model-") is the difference
 * between a result and an aborted sweep.
 */
const ONLY = (process.env.SWAP_AB_ONLY ?? '').split(',').map((x) => x.trim()).filter(Boolean)

const PROMPT =
  'candid photograph of a woman standing on a city street, head turned three-quarters to camera, ' +
  'natural skin texture, overcast daylight, 85mm, shallow depth of field'

const MODELS = ['inswapper_128.onnx', 'hyperswap_1c_256.onnx', 'alphaface_256.onnx'] as const

/**
 * Consecutive failures after which the sweep gives up. A poisoned ComfyUI fails
 * every remaining leg identically, so continuing only wastes minutes producing
 * black frames — and buries the one real failure under twenty copies of itself.
 */
const POISON_STREAK = 3

const RENDER_TIMEOUT_MS = 45 * 60_000
const POLL_MS = 1_500

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

/**
 * The scorer, written out at run time and executed with ComfyUI's own venv.
 *
 * It imports the vendored pack's `analyzer` rather than insightface: that module
 * IS our SCRFD + ArcFace stack, the venv has no insightface package at all, and
 * scoring with the same recognizer the swapper conditions on keeps the metric
 * honest.
 */
const SCORER = [
  'import json, sys, os',
  "sys.path.insert(0, os.environ['PACK_DIR'])",
  'import cv2, numpy as np',
  'import analyzer',
  '',
  "A = analyzer.Analyzer(os.path.join(os.environ['MODELS_DIR'], 'insightface', 'models', 'buffalo_l'))",
  '',
  'def biggest(img):',
  '    faces = A.get(img)',
  '    if not faces:',
  '        return None',
  '    return max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))',
  '',
  'def crop_sharpness(img, face):',
  '    # Face crop only. Whole-frame Laplacian energy tracks background bokeh and',
  '    # film grain, which is how a previous sweep read a better render as worse.',
  '    x1, y1, x2, y2 = [int(v) for v in face.bbox]',
  '    x1, y1 = max(0, x1), max(0, y1)',
  '    c = img[y1:y2, x1:x2]',
  '    if c.size == 0:',
  '        return 0.0',
  '    c = cv2.resize(c, (256, 256))',
  '    return float(cv2.Laplacian(cv2.cvtColor(c, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())',
  '',
  'ref_path = sys.argv[1]',
  'targets = sys.argv[2:]',
  'ref = biggest(cv2.imread(ref_path))',
  'if ref is None:',
  "    print(json.dumps({'error': 'no face in the reference photo: ' + ref_path})); sys.exit(0)",
  'ref_e = ref.normed_embedding',
  '',
  'out = {}',
  'for t in targets:',
  '    img = cv2.imread(t)',
  '    if img is None:',
  "        out[t] = {'error': 'unreadable'}; continue",
  '    f = biggest(img)',
  '    if f is None:',
  '        # Not a scoring failure to hide: a swap that produced no detectable',
  '        # face is the most important thing this harness can report.',
  "        out[t] = {'error': 'no face detected in render'}; continue",
  '    out[t] = {',
  "        'identity': float(np.dot(ref_e, f.normed_embedding)),",
  "        'face_sharpness': crop_sharpness(img, f),",
  "        'face_px': int(f.bbox[2] - f.bbox[0]),",
  '    }',
  'print(json.dumps(out))',
  '',
].join('\n')

interface Score {
  identity?: number
  face_sharpness?: number
  face_px?: number
  error?: string
}

/** One render: which leg, which seed, where it landed. */
interface Leg {
  leg: string
  seed: number
  file: string
  seconds: number
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)

describe.skipIf(!LIVE)('face swap A/B — live', () => {
  const env = { ...readEnvLocal(), ...process.env }
  const base = (env.COMFYUI_BASE_URL || 'http://localhost:8188').replace(/\/$/, '')
  const outputDir = env.COMFYUI_OUTPUT_DIR ?? ''
  const modelsDir = env.COMFYUI_MODELS_DIR ?? ''
  const repoRoot = path.resolve(__dirname, '../../../..')
  const packDir = path.join(repoRoot, 'comfyui/ComfyUI/custom_nodes/RaccoonSwapNodes')
  const venvPython = path.join(repoRoot, 'comfyui/ComfyUI/.venv/Scripts/python.exe')
  const legs: Leg[] = []
  const failures: { leg: string; seed: number; why: string }[] = []
  let streak = 0
  let sdxlInstalled = false

  const params = (seed: number, over: Partial<GenerationParams> = {}): GenerationParams =>
    ({
      prompt: PROMPT,
      width: 832,
      height: 1216,
      seed,
      upscale: false,
      detailer: false,
      promptEnhancer: false,
      faceSwap: true,
      faceSwapSource: 'upload',
      inputImage: SOURCE_FACE,
      faceSwapPixelBoost: true,
      faceSwapPixelBoostSize: '512x512',
      ...over,
    }) as GenerationParams

  /**
   * Film grain is unseeded noise: it would differ between two otherwise
   * identical renders and it inflates the sharpness metric. Dropping it makes
   * the swap the only difference between legs.
   */
  function withoutGrain(wf: ComfyUIPrompt, saveId: string): ComfyUIPrompt {
    if (wf['grain:film']) {
      wf[saveId].inputs.images = wf['grain:film'].inputs.image
      delete wf['grain:film']
    }
    return wf
  }

  /**
   * Render one leg. A leg that FAILS is recorded and skipped, never thrown:
   * the DynamicVRAM corruption this harness exists to detect can be severe
   * enough that the swap node aborts the job outright ("no target face found in
   * any frame"), and letting that kill the process throws away every leg and
   * seed that had not run yet. An intermittent fault has to be survivable by the
   * thing measuring it.
   */
  async function render(leg: string, seed: number, wf: ComfyUIPrompt): Promise<void> {
    // No /free between legs — see the black-frame note in the file header.
    const res = await fetch(`${base}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: wf, client_id: 'raccoon-swap-ab' }),
    })
    const body = await res.text()
    if (!res.ok) {
      console.log(`  [${leg}/${seed}] REJECTED: ${body.slice(0, 300)}`)
      failures.push({ leg, seed, why: `POST /prompt rejected: ${body.slice(0, 200)}` })
      streak++
      return
    }
    const { prompt_id } = JSON.parse(body) as { prompt_id: string }

    const started = Date.now()
    let entry:
      | {
          status?: { completed?: boolean; status_str?: string; messages?: unknown[] }
          outputs?: Record<string, { images?: { filename: string; subfolder: string }[] }>
        }
      | undefined
    while (Date.now() - started < RENDER_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS))
      const hist = await fetch(`${base}/history/${prompt_id}`)
        .then((r) => r.json())
        .catch(() => ({}))
      entry = (hist as Record<string, typeof entry>)[prompt_id]
      if (entry?.status?.completed !== undefined || entry?.status?.status_str === 'error') break
    }
    const seconds = (Date.now() - started) / 1000
    if (!entry || entry.status?.status_str !== 'success') {
      const why = entry
        ? String(JSON.stringify(entry.status?.messages)).match(/"exception_message":"([^"]*)"/)?.[1] ??
          'render failed'
        : `no /history entry after ${seconds.toFixed(0)}s`
      console.log(`  [${leg}/${seed}] FAILED: ${why}`)
      failures.push({ leg, seed, why })
      streak++
      return
    }

    const images = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? [])
    if (images.length === 0) {
      failures.push({ leg, seed, why: 'no output image' })
      streak++
      return
    }
    const src = path.join(outputDir, images[0].subfolder, images[0].filename)
    const file = path.join(OUT_DIR, `${leg.replace(/[^a-z0-9._-]/gi, '_')}__${seed}.png`)
    fs.copyFileSync(src, file)
    legs.push({ leg, seed, file, seconds })
    streak = 0
    console.log(`  [${leg}/${seed}] ${seconds.toFixed(1)}s`)
  }

  function score(files: string[]): Record<string, Score> {
    const scorer = path.join(OUT_DIR, '_score.py')
    fs.writeFileSync(scorer, SCORER)
    const inputDir = env.COMFYUI_INPUT_DIR || path.join(repoRoot, 'comfyui/ComfyUI/input')
    const ref = path.join(inputDir, SOURCE_FACE)
    expect(fs.existsSync(ref), `source face not found on disk: ${ref}`).toBe(true)
    const out = execFileSync(venvPython, [scorer, ref, ...files], {
      env: { ...process.env, PACK_DIR: packDir, MODELS_DIR: modelsDir },
      maxBuffer: 32 * 1024 * 1024,
    }).toString()
    const parsed = JSON.parse(out.trim().split('\n').pop()!) as Record<string, Score>
    if (parsed.error) throw new Error(String(parsed.error))
    return parsed
  }

  beforeAll(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const stats = await fetch(`${base}/system_stats`).catch(() => null)
    if (!stats?.ok) throw new Error(`ComfyUI is not answering on ${base} — start it first`)
    expect(fs.existsSync(outputDir), 'COMFYUI_OUTPUT_DIR exists').toBe(true)
    expect(fs.existsSync(venvPython), `ComfyUI venv python at ${venvPython}`).toBe(true)

    const ck = (await (await fetch(`${base}/object_info/CheckpointLoaderSimple`)).json()) as {
      CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: [string[]] } } }
    }
    sdxlInstalled = (ck.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? []).includes(SDXL_CKPT)
  }, 60_000)

  it('ComfyUI offers every swap model this harness renders', async () => {
    // A model ComfyUI does not list fails validation, so an absent file would
    // otherwise surface as a confusing mid-run 400 rather than a clear skip.
    const info = (await (await fetch(`${base}/object_info/RaccoonPixelBoostSwap`)).json()) as {
      RaccoonPixelBoostSwap?: {
        input?: { required?: { swap_model?: [string[]]; identity?: unknown } }
      }
    }
    const req = info.RaccoonPixelBoostSwap?.input?.required
    const names = req?.swap_model?.[0] ?? []
    for (const m of MODELS) {
      expect(names, `${m} is missing — download it on the Models page`).toContain(m)
    }
    // The identity dial only exists after a ComfyUI restart picks up the pack.
    expect(
      req?.identity,
      'RaccoonPixelBoostSwap has no `identity` input — restart ComfyUI so it reloads the pack',
    ).toBeTruthy()
  })

  it('renders every leg across every seed', async () => {
    const swap = (over: Partial<GenerationParams>) => (seed: number) =>
      withoutGrain(krea2TurboWorkflow.buildPrompt(params(seed, over)), 'k:save')

    /**
     * Ordered least- to most-corruption-prone. Everything above `order-*` is a
     * single diffusion pass plus pixel work; the detailer legs add a SECOND
     * diffusion pass on an fp8_scaled model, which is what actually corrupts —
     * and a corrupted render poisons every later one. Running leg-major in this
     * order means the model comparison is complete across all seeds before
     * anything risky runs.
     */
    const matrix: { leg: string; build: (seed: number) => ComfyUIPrompt }[] = [
      ...MODELS.map((model) => ({
        leg: `model-${model.replace('.onnx', '')}`,
        build: swap({ faceSwapModel: model }),
      })),
      ...[0, 1].map((identity) => ({
        leg: `identity-${identity}`,
        build: swap({ faceSwapModel: 'alphaface_256.onnx', faceSwapIdentity: identity }),
      })),

      // Control first, so the detailer legs are interpretable even if the last
      // one poisons the process.
      { leg: 'order-none', build: swap({ faceSwapModel: 'alphaface_256.onnx' }) },
      { leg: 'order-new', build: swap({ faceSwapModel: 'alphaface_256.onnx', detailer: true }) },
      {
        leg: 'order-old',
        build: (seed: number) => {
          // Build the detailer chain through the builder with the swap OFF (which
          // yields the pre-change 0.25 denoise), then append the swap on top so it
          // paints over the redrawn face — exactly the pipeline that used to ship.
          const old = krea2TurboWorkflow.buildPrompt(
            params(seed, { faceSwap: false, inputImage: undefined, detailer: true }),
          )
          withoutGrain(old, 'k:save')
          expect(old['det:face'].inputs.denoise, 'old order used the un-reduced detailer denoise').toBe(0.25)
          appendFaceSwap(old, {
            saveNodeId: 'k:save',
            faceFilename: SOURCE_FACE,
            swapModel: 'alphaface_256.onnx',
            pixelBoost: true,
            pixelBoostSize: '512x512',
          })
          return old
        },
      },
      // SDXL LAST, always. These legs load a different checkpoint, which evicts
      // Krea2 — and reloading Krea2 after a swap has run in this process is
      // exactly the poisoned path, so any Krea2 leg after them renders black.
      ...(sdxlInstalled
        ? (['inswapper_128.onnx', 'alphaface_256.onnx'] as const).map((model) => ({
            leg: `sdxl-${model.replace('.onnx', '')}`,
            build: (seed: number) => {
              const g = withoutGrain(sdxlWorkflow.buildPrompt(params(seed, { faceSwapModel: model })), '9')
              // The stock SDXL checkpoint is not installed everywhere; point the
              // loader at whatever SDXL-family file this box has. Without this the
              // legs 400 at validation even though the presence check passed.
              const loader = Object.keys(g).find((k) => g[k].class_type === 'CheckpointLoaderSimple')
              if (loader) g[loader].inputs.ckpt_name = SDXL_CKPT
              return g
            },
          }))
        : []),
    ]

    const selected = ONLY.length ? matrix.filter((m) => ONLY.some((o) => m.leg.startsWith(o))) : matrix
    console.log(`SWEEP: ${selected.length} legs x ${SEEDS.length} seeds`)
    outer: for (const { leg, build } of selected) {
      for (const seed of SEEDS) {
        await render(leg, seed, build(seed))
        if (streak >= POISON_STREAK) {
          console.log(
            `
SWEEP ABORTED: ${streak} renders failed in a row. ComfyUI is almost certainly ` +
              `poisoned by a corrupted Krea2 render — restart it and re-run. Legs completed so far ` +
              `are still scored below.
`,
          )
          break outer
        }
      }
    }

    if (!sdxlInstalled) {
      console.log(`
  (SDXL legs skipped — ${SDXL_CKPT} is not installed; set SWAP_AB_SDXL_CKPT)
`)
    }
    console.log(`SWEEP: done, ${legs.length} rendered, ${failures.length} failed`)
    if (failures.length) {
      console.log('--- failed renders (recorded, not fatal) ---')
      console.table(failures)
    }
    expect(legs.length, 'at least one leg rendered').toBeGreaterThan(0)
  }, RENDER_TIMEOUT_MS)

  it('scores every render and aggregates per leg', () => {
    const scores = score(legs.map((l) => l.file))

    // Corruption guard. Krea2 Turbo is fp8_scaled, so a diffusion pass can emit
    // the DynamicVRAM rainbow — confined to the detailer's crop, which the
    // project's whole-frame channel-spread metric does NOT detect. The pair that
    // does: identity collapses toward zero while face sharpness explodes.
    // Threshold off the median so it scales with the scene instead of a magic
    // number, and drop those runs rather than averaging them in.
    const sharps = legs.map((l) => scores[l.file]?.face_sharpness ?? 0).sort((a, b) => a - b)
    const medianSharp = sharps[Math.floor(sharps.length / 2)] || 1
    const corrupt = (s?: Score) =>
      !s || s.error !== undefined || (s.face_sharpness ?? 0) > 5 * medianSharp || (s.identity ?? 0) < 0.2

    const perRun = legs.map((l) => {
      const s = scores[l.file]
      return {
        leg: l.leg,
        seed: l.seed,
        identity: s?.identity !== undefined ? Number(s.identity.toFixed(4)) : undefined,
        faceSharpness: s?.face_sharpness !== undefined ? Number(s.face_sharpness.toFixed(1)) : undefined,
        seconds: Number(l.seconds.toFixed(1)),
        corrupt: corrupt(s) || undefined,
      }
    })
    console.log('\n--- per run ---')
    console.table(perRun)

    const names = [...new Set(legs.map((l) => l.leg))]
    const summary = names
      .map((name) => {
        const runs = legs.filter((l) => l.leg === name)
        const clean = runs.filter((l) => !corrupt(scores[l.file]))
        return {
          leg: name,
          runs: runs.length,
          dropped: runs.length - clean.length,
          identity: clean.length ? Number(mean(clean.map((l) => scores[l.file].identity!)).toFixed(4)) : undefined,
          faceSharpness: clean.length
            ? Number(mean(clean.map((l) => scores[l.file].face_sharpness!)).toFixed(1))
            : undefined,
          seconds: Number(mean(runs.map((l) => l.seconds)).toFixed(1)),
        }
      })
      .sort((a, b) => (b.identity ?? -1) - (a.identity ?? -1))
    console.log('\n--- summary (corrupted runs dropped) ---')
    console.table(summary)

    fs.writeFileSync(
      path.join(OUT_DIR, 'results.json'),
      JSON.stringify({ seeds: SEEDS, source: SOURCE_FACE, medianSharp, perRun, summary, failures }, null, 2),
    )
    console.log(`\n  images + results.json in ${OUT_DIR}\n`)

    // Assertions are deliberately thin: the rankings are the finding, not a
    // pass/fail gate. What IS worth failing on is a leg with no usable run at
    // all — that means the swap silently produced no face, or corrupted every
    // time, and either way the numbers above cannot be trusted.
    for (const row of summary) {
      expect(row.identity, `[${row.leg}] every run was corrupt or faceless`).toBeDefined()
    }
    // Legs that never produced a single usable render are reported, not hidden:
    // a leg missing from the table entirely is the most misleading outcome.
    const rendered = new Set(summary.map((r) => r.leg))
    const lost = [...new Set(failures.map((f) => f.leg))].filter((l) => !rendered.has(l))
    expect(lost, `these legs failed every seed: ${lost.join(', ')}`).toEqual([])
  })
})
