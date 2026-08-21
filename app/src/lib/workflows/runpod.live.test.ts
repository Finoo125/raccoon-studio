/**
 * Live render of every image family against a RunPod pod, through the pod's
 * ONE published port.
 *
 *   RUNPOD_BASE=https://<pod>-8080.proxy.runpod.net RUNPOD_PASS=<password> \
 *     node_modules/.bin/vitest run src/lib/workflows/runpod.live.test.ts
 *
 * Why this exists separately from the other *.live.test.ts files: those talk to
 * a ComfyUI on loopback. A pod publishes only the login proxy, so every call has
 * to carry a session cookie and go through `/api/comfyui/*`. That path — proxy →
 * Next route handler → ComfyUI — is exactly what a real user's browser uses and
 * what no offline test covers.
 *
 * A family whose weights are not on the pod is SKIPPED, not failed, and says so.
 * The skip is keyed off ComfyUI's own validation error naming the missing file,
 * so a family that is installed can never silently skip.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { workflows } from './index'
import { getVideoWorkflow } from './video-index'
import type { GenerationParams } from '@/types/workflow'
import type { VideoGenerationParams } from '@/types/video-workflow'

interface OutputImage { filename: string; subfolder: string; type: string }
type Outputs = Record<string, { images?: OutputImage[] }>
interface HistoryEntry { outputs?: Outputs; status?: { completed?: boolean } }

const BASE = process.env.RUNPOD_BASE
const PASS = process.env.RUNPOD_PASS
const LIVE = Boolean(BASE && PASS)

const RENDER_TIMEOUT_MS = 12 * 60_000
const POLL_MS = 2_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let cookie = ''

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'raccoon', password: PASS! }),
    redirect: 'manual',
  })
  const m = /rs_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')
  if (!m) throw new Error(`pod login failed: http ${res.status}`)
  return `rs_session=${m[1]}`
}

const api = (path: string, init: RequestInit = {}) =>
  fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie } })

/**
 * Fresh per run and logged. A fixed seed makes the graph byte-identical to the
 * previous run, and ComfyUI's execution cache then returns the old result
 * without sampling anything — a smoke test a completely broken model passes.
 */
const SEED = Number(process.env.LIVE_SEED ?? Date.now() % 9_000_000_000)

const params = (): GenerationParams => ({
  prompt: 'a raccoon wearing headphones in a recording studio, cinematic lighting',
  negativePrompt: 'blurry, watermark',
  width: 768,
  height: 768,
  seed: SEED,
})

describe.skipIf(!LIVE)('RunPod pod — image families', () => {
  beforeAll(async () => {
    cookie = await login()
    console.log(`[runpod] seed ${SEED}`)
  })

  it('the pod is serving a healthy ComfyUI', async () => {
    const r = await api('/api/comfyui/system_stats')
    expect(r.status).toBe(200)
    const j = (await r.json()) as { system: { comfyui_version: string } }
    console.log(`[runpod] ComfyUI ${j.system.comfyui_version}`)
  })

  for (const wf of workflows) {
    it(
      `${wf.id} renders through the proxy`,
      async (ctx) => {
        const graph = wf.buildPrompt(params())
        const sub = await api('/api/comfyui/prompt', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: graph, client_id: `e2e-${wf.id}` }),
        })

        if (sub.status !== 200) {
          const text = await sub.text()
          // ComfyUI names the offending file when a model is absent. Anything
          // else is a real failure and must not be swallowed as "not installed".
          if (/not in list|value not in|does not exist/i.test(text)) {
            // ctx.skip(), never `return`: a returned test is reported as a
            // PASS, so an absent model would look exactly like a good render —
            // the failure mode this whole file exists to rule out.
            ctx.skip(`weights absent: ${wf.baseModel}`)
            return
          }
          throw new Error(`${wf.id}: submit failed ${sub.status}: ${text.slice(0, 500)}`)
        }

        const { prompt_id: id } = (await sub.json()) as { prompt_id: string }
        const deadline = Date.now() + RENDER_TIMEOUT_MS
        let outputs: Outputs | null = null
        for (;;) {
          if (Date.now() > deadline) throw new Error(`${wf.id}: render timed out`)
          await sleep(POLL_MS)
          const h = await api(`/api/comfyui/history/${id}`)
          if (h.status !== 200) continue
          const j = (await h.json()) as Record<string, HistoryEntry>
          const entry = j[id]
          if (!entry) continue
          if (entry.status?.completed === false) throw new Error(`${wf.id}: ComfyUI reported failure`)
          if (entry.outputs && Object.keys(entry.outputs).length) { outputs = entry.outputs; break }
        }

        const images = Object.values(outputs!).flatMap((o) => o.images ?? [])
        expect(images.length, `${wf.id} produced no image`).toBeGreaterThan(0)

        // Fetch the bytes back the same way the gallery does, and require a real
        // PNG — an empty or truncated file would otherwise read as a pass.
        const first = images[0]
        const view = await api(
          `/api/comfyui/view?filename=${encodeURIComponent(first.filename)}` +
            `&subfolder=${encodeURIComponent(first.subfolder)}&type=${first.type}`,
        )
        expect(view.status).toBe(200)
        const buf = Buffer.from(await view.arrayBuffer())
        expect(buf.subarray(0, 8), `${wf.id}: not a PNG`).toEqual(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        )
        expect(buf.length, `${wf.id}: suspiciously small image`).toBeGreaterThan(50_000)
        console.log(`[runpod] OK ${wf.id} — ${first.filename} (${(buf.length / 1024).toFixed(0)} KB)`)
      },
      RENDER_TIMEOUT_MS + 60_000,
    )
  }
})


/**
 * Video is billed by the minute, so both graphs run at their cheapest honest
 * settings — H3 on the 6-step Draft tier, LTX at 5 s in the low-VRAM budget —
 * rather than the form defaults (20 steps / 15 s), which prove nothing extra
 * about whether the pod can render at all.
 *
 * t2v only: i2v would need an image uploaded into ComfyUI's input dir first,
 * which is a separate path and gets its own coverage.
 */
describe.skipIf(!LIVE)('RunPod pod — video families', () => {
  beforeAll(async () => { if (!cookie) cookie = await login() })

  const cases: { id: string; params: Partial<VideoGenerationParams> }[] = [
    { id: 'minimax-h3', params: { durationSeconds: 4, turbo: 'draft', vramMode: 'low' } },
    { id: 'ltx23', params: { durationSeconds: 5, vramMode: 'low' } },
  ]

  for (const c of cases) {
    it(
      `${c.id} renders a clip through the proxy`,
      async (ctx) => {
        const wf = getVideoWorkflow(c.id)!
        const graph = wf.buildPrompt({
          ...wf.defaultParams,
          ...c.params,
          prompt: 'a raccoon dj playing records in a neon-lit studio, slow push in',
          mode: 't2v',
          videoModel: c.id,
          seed: SEED,
        } as VideoGenerationParams)

        const sub = await api('/api/comfyui/prompt', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: graph, client_id: `e2e-${c.id}` }),
        })
        if (sub.status !== 200) {
          const text = await sub.text()
          if (/not in list|value not in|does not exist/i.test(text)) {
            ctx.skip(`weights absent for ${c.id}`)
            return
          }
          throw new Error(`${c.id}: submit failed ${sub.status}: ${text.slice(0, 800)}`)
        }

        const { prompt_id: id } = (await sub.json()) as { prompt_id: string }
        const started = Date.now()
        const deadline = started + RENDER_TIMEOUT_MS
        let outputs: Outputs | null = null
        for (;;) {
          if (Date.now() > deadline) throw new Error(`${c.id}: render timed out`)
          await sleep(POLL_MS)
          const h = await api(`/api/comfyui/history/${id}`)
          if (h.status !== 200) continue
          const j = (await h.json()) as Record<string, HistoryEntry>
          const entry = j[id]
          if (!entry) continue
          if (entry.status?.completed === false) throw new Error(`${c.id}: ComfyUI reported failure`)
          if (entry.outputs && Object.keys(entry.outputs).length) { outputs = entry.outputs; break }
        }

        // The output KEY does not identify the medium — VHS_VideoCombine reports
        // mp4 under `gifs`, core SaveVideo under `images` with animated:true.
        // Go by the filename extension, exactly as resolveOutputMedia does.
        const files = Object.values(outputs!).flatMap(
          (o) => (o as { images?: OutputImage[]; gifs?: OutputImage[] }).images ?? (o as { gifs?: OutputImage[] }).gifs ?? [],
        )
        const clip = files.find((f) => /\.(mp4|webm|mkv)$/i.test(f.filename))
        expect(clip, `${c.id}: no video in outputs (${files.map((f) => f.filename).join(', ')})`).toBeTruthy()

        const view = await api(
          `/api/comfyui/view?filename=${encodeURIComponent(clip!.filename)}` +
            `&subfolder=${encodeURIComponent(clip!.subfolder)}&type=${clip!.type}`,
        )
        expect(view.status).toBe(200)
        const buf = Buffer.from(await view.arrayBuffer())
        // ISO-BMFF: bytes 4..8 are the 'ftyp' box type.
        expect(buf.subarray(4, 8).toString('ascii'), `${c.id}: not an mp4`).toBe('ftyp')
        expect(buf.length).toBeGreaterThan(100_000)
        console.log(
          `[runpod] OK ${c.id} — ${clip!.filename} ${(buf.length / 1e6).toFixed(2)} MB in ${((Date.now() - started) / 1000).toFixed(0)}s`,
        )
      },
      RENDER_TIMEOUT_MS + 60_000,
    )
  }
})


/**
 * Face swap on a pod. Worth its own case because it is the one stage built on
 * ONNX rather than torch: the ReActor/hyperswap stack, which is also where a
 * duplicate ComfyUI silently breaks an install (a half-written onnxruntime
 * imports as an attribute-less namespace package). If the pack failed to import
 * at boot, the graph 400s on a missing node type rather than rendering badly —
 * so this distinguishes "face swap is broken" from "face swap looks wrong".
 */
describe.skipIf(!LIVE)('RunPod pod — face swap', () => {
  beforeAll(async () => { if (!cookie) cookie = await login() })

  it('renders SDXL with a ReActor swap applied', async (ctx) => {
    // Put a real face-bearing image into ComfyUI's input dir first: the swap
    // source is a filename there, not an upload in the prompt.
    const gal = await api('/api/gallery?refresh=true')
    const imgs = (await gal.json()) as { images?: { filename: string; subfolder?: string }[] }
    const src = imgs.images?.[0]
    if (!src) { ctx.skip('no gallery image to use as a source face'); return }

    const bytes = Buffer.from(
      await (
        await api(`/api/comfyui/view?filename=${encodeURIComponent(src.filename)}&subfolder=${encodeURIComponent(src.subfolder ?? '')}&type=output`)
      ).arrayBuffer(),
    )
    const form = new FormData()
    form.append('image', new File([bytes], 'e2e-face.png', { type: 'image/png' }))
    form.append('overwrite', 'true')
    form.append('type', 'input')
    const up = await api('/api/comfyui/upload/image', { method: 'POST', body: form })
    expect(up.status, 'upload of the source face failed').toBe(200)

    const wf = workflows.find((w) => w.id === 'sdxl')!
    const graph = wf.buildPrompt({
      ...params(),
      faceSwap: true,
      faceSwapSource: 'upload',
      inputImage: 'e2e-face.png',
      faceSwapModel: 'inswapper_128.onnx',
    } as GenerationParams)

    const sub = await api('/api/comfyui/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: 'e2e-faceswap' }),
    })
    if (sub.status !== 200) {
      const text = await sub.text()
      throw new Error(`face swap submit failed ${sub.status}: ${text.slice(0, 600)}`)
    }
    const { prompt_id: id } = (await sub.json()) as { prompt_id: string }

    const deadline = Date.now() + RENDER_TIMEOUT_MS
    let outputs: Outputs | null = null
    for (;;) {
      if (Date.now() > deadline) throw new Error('face swap render timed out')
      await sleep(POLL_MS)
      const h = await api(`/api/comfyui/history/${id}`)
      if (h.status !== 200) continue
      const j = (await h.json()) as Record<string, HistoryEntry>
      const e = j[id]
      if (!e) continue
      if (e.status?.completed === false) throw new Error('ComfyUI reported failure on the face-swap graph')
      if (e.outputs && Object.keys(e.outputs).length) { outputs = e.outputs; break }
    }
    const images = Object.values(outputs!).flatMap((o) => o.images ?? [])
    expect(images.length).toBeGreaterThan(0)
    console.log(`[runpod] OK face-swap — ${images[0].filename}`)
  }, RENDER_TIMEOUT_MS + 60_000)
})
