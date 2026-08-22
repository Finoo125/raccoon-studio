/**
 * DynamicVRAM on a pod, re-tested on a different GPU — the open question in
 * `to-do.md` #28.
 *
 *   RUNPOD_BASE=https://<pod>-8080.proxy.runpod.net RUNPOD_PASS=<password> \
 *     RUNPOD_OUT=<dir> node_modules/.bin/vitest run \
 *     src/lib/workflows/runpod-dynvram.live.test.ts
 *
 * Run A found that a 48 GB A40 pod dies the instant DynamicVRAM stages a large
 * tensor set — H3's text encoder at 14956 MB and Z-Image's Lumina2 at 11738 MB —
 * with no OOM and no traceback, while a 5090 *desktop* renders H3 with the flag
 * ON. GPU generation, host driver and container were all confounded, so the
 * workaround shipped without a diagnosis.
 *
 * This file is the deconfounding run: same three families, DynamicVRAM ON, on a
 * 5090 pod. If it crashes here too the GPU is not the variable and the pod is;
 * if it renders, the A40 or its host was.
 *
 * Three things separate it from `runpod.live.test.ts`, which asks the much
 * broader "does every family render through the proxy":
 *  - the order is fixed and meaningful — the small stage first, then the two
 *    models that killed the A40, so a crash cannot be blamed on its predecessor;
 *  - a crash is a *result*, not an error. ComfyUI dying is what we came to
 *    measure, so the poll loop detects it (the proxy 502s), keeps the last log
 *    it saw before the process went quiet, and restarts ComfyUI for the next
 *    case rather than stranding the run;
 *  - every render is preceded by `POST /free`, because one poisoned run makes
 *    every later comparison worthless.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import { workflows } from './index'
import { getVideoWorkflow } from './video-index'
import type { GenerationParams } from '@/types/workflow'
import type { VideoGenerationParams } from '@/types/video-workflow'

interface OutputFile { filename: string; subfolder: string; type: string }
type Outputs = Record<string, { images?: OutputFile[]; gifs?: OutputFile[] }>
interface HistoryEntry { outputs?: Outputs; status?: { completed?: boolean } }

const BASE = process.env.RUNPOD_BASE
const PASS = process.env.RUNPOD_PASS
const OUT = process.env.RUNPOD_OUT
const LIVE = Boolean(BASE && PASS)

const RENDER_TIMEOUT_MS = 15 * 60_000
const POLL_MS = 3_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let cookie = ''
const api = (p: string, init: RequestInit = {}) =>
  fetch(`${BASE}${p}`, { ...init, headers: { ...(init.headers ?? {}), cookie } })

/** Thrown when ComfyUI stops answering mid-render — the failure under test. */
class ComfyDied extends Error {
  constructor(public tail: string) {
    super('ComfyUI died mid-render')
  }
}

const SEED = Number(process.env.LIVE_SEED ?? Date.now() % 9_000_000_000)

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

/**
 * Unload everything between cases. Without it the second render inherits the
 * first's resident models, and "model X crashes" turns into a claim about the
 * Nth render — which is how Run A first blamed Krea2 for H3's memory.
 */
async function freeModels() {
  await api('/api/comfyui/free', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  }).catch(() => {})
  await sleep(3_000)
}

async function comfyAlive(): Promise<boolean> {
  const r = await api('/api/comfyui/system_stats').catch(() => null)
  return r?.status === 200
}

/**
 * ComfyUI's own log. The last copy taken before the process goes quiet is the
 * crash evidence — the signature is that it simply stops mid-line.
 */
async function comfyLog(): Promise<string> {
  const r = await api('/api/comfyui/internal/logs/raw').catch(() => null)
  if (!r || r.status !== 200) return ''
  const text = await r.text()
  try {
    const j = JSON.parse(text) as { entries?: { m?: string }[] }
    if (j.entries) return j.entries.map((e) => e.m ?? '').join('')
  } catch {
    /* not JSON — already raw */
  }
  return text
}

async function restartComfy(): Promise<boolean> {
  await api('/api/comfyui-control/start', { method: 'POST' })
  for (let i = 0; i < 60; i++) {
    await sleep(5_000)
    if (await comfyAlive()) return true
  }
  return false
}

/** Submit, then poll until outputs land, ComfyUI reports failure, or it dies. */
async function runGraph(label: string, graph: unknown): Promise<{ outputs: Outputs; ms: number }> {
  const sub = await api('/api/comfyui/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: `dynvram-${label}` }),
  })
  if (sub.status !== 200) throw new Error(`${label}: submit ${sub.status}: ${(await sub.text()).slice(0, 600)}`)
  const { prompt_id: id } = (await sub.json()) as { prompt_id: string }

  const started = Date.now()
  const deadline = started + RENDER_TIMEOUT_MS
  let tail = ''
  let misses = 0
  for (let tick = 0; ; tick++) {
    if (Date.now() > deadline) {
      throw new Error(`${label}: timed out after ${RENDER_TIMEOUT_MS / 1000}s\n${tail.slice(-2000)}`)
    }
    await sleep(POLL_MS)

    const h = await api(`/api/comfyui/history/${id}`).catch(() => null)
    if (!h || h.status !== 200) {
      // A 502 from the proxy means ComfyUI refused the connection. Confirm
      // before calling it a death: one blip is not a crash.
      if (++misses >= 3 && !(await comfyAlive())) throw new ComfyDied(tail)
      continue
    }
    misses = 0
    // Refresh the log only while it is still answering; once it stops, the copy
    // from the previous tick is the last thing the process ever wrote.
    if (tick % 3 === 0) tail = (await comfyLog()) || tail

    const entry = ((await h.json()) as Record<string, HistoryEntry>)[id]
    if (!entry) continue
    if (entry.status?.completed === false) {
      throw new Error(`${label}: ComfyUI reported failure\n${tail.slice(-2000)}`)
    }
    if (entry.outputs && Object.keys(entry.outputs).length) {
      return { outputs: entry.outputs, ms: Date.now() - started }
    }
  }
}

async function fetchOutput(f: OutputFile): Promise<Buffer> {
  const r = await api(
    `/api/comfyui/view?filename=${encodeURIComponent(f.filename)}` +
      `&subfolder=${encodeURIComponent(f.subfolder)}&type=${f.type}`,
  )
  expect(r.status, `view ${f.filename}`).toBe(200)
  const buf = Buffer.from(await r.arrayBuffer())
  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(OUT, f.filename), buf)
  }
  return buf
}

const imageParams = (): GenerationParams => ({
  prompt: 'close-up portrait photograph of a woman, natural skin texture, 50mm, soft window light',
  negativePrompt: 'blurry, watermark',
  width: 768,
  height: 768,
  seed: SEED,
  // Off deliberately: both default ON when absent, and this file asks whether
  // DynamicVRAM survives the base render — not whether a 3x-VRAM post-chain fits.
  upscale: false,
  detailer: false,
})

describe.skipIf(!LIVE)('RunPod pod — DynamicVRAM ON', () => {
  beforeAll(async () => {
    cookie = await login()
    console.log(`[dynvram] seed ${SEED}`)
  })

  it('is actually running with DynamicVRAM enabled', async () => {
    const r = await api('/api/comfyui/system_stats')
    expect(r.status).toBe(200)
    const j = (await r.json()) as {
      system: { comfyui_version: string; argv: string[] }
      devices: { name: string; vram_total: number }[]
    }
    const argv = j.system.argv.join(' ')
    console.log(`[dynvram] ComfyUI ${j.system.comfyui_version} — ${j.devices[0]?.name}`)
    console.log(`[dynvram] argv: ${argv}`)
    console.log(`[dynvram] vram_total ${(j.devices[0]!.vram_total / 2 ** 30).toFixed(1)} GiB`)
    // The run is meaningless if the flag did not land, and the env alone does
    // not prove it — read what ComfyUI was actually started with.
    expect(argv, 'DynamicVRAM is DISABLED — this run would prove nothing').not.toContain(
      '--disable-dynamic-vram',
    )
  })

  // Order is the experiment. Krea2 staged ~4.9 GB on the A40 and was fine;
  // Z-Image and H3 both staged >11 GB and both killed the process.
  const cases = ['krea2-turbo', 'z-image-turbo'] as const
  for (const id of cases) {
    it(
      `${id} renders`,
      async () => {
        await freeModels()
        const wf = workflows.find((w) => w.id === id)!
        let res: Awaited<ReturnType<typeof runGraph>>
        try {
          res = await runGraph(id, wf.buildPrompt(imageParams()))
        } catch (e) {
          if (e instanceof ComfyDied) {
            console.log(`[dynvram] X ${id} KILLED ComfyUI. Last log:\n${e.tail.slice(-1500)}`)
            const back = await restartComfy()
            console.log(`[dynvram] restart after ${id}: ${back ? 'ComfyUI is back' : 'FAILED — pod is stranded'}`)
          }
          throw e
        }
        const images = Object.values(res.outputs).flatMap((o) => o.images ?? [])
        expect(images.length, `${id} produced no image`).toBeGreaterThan(0)
        const buf = await fetchOutput(images[0])
        expect(buf.subarray(0, 8), `${id}: not a PNG`).toEqual(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        )
        expect(buf.length).toBeGreaterThan(50_000)
        console.log(
          `[dynvram] OK ${id} — ${images[0].filename} ${(buf.length / 1024).toFixed(0)} KB in ${(res.ms / 1000).toFixed(0)}s`,
        )
      },
      RENDER_TIMEOUT_MS + 5 * 60_000,
    )
  }

  it(
    'minimax-h3 renders a clip',
    async () => {
      await freeModels()
      const wf = getVideoWorkflow('minimax-h3')!
      const graph = wf.buildPrompt({
        ...wf.defaultParams,
        prompt: 'a raccoon dj playing records in a neon-lit studio, slow push in',
        mode: 't2v',
        videoModel: 'minimax-h3',
        durationSeconds: 4,
        turbo: 'draft',
        vramMode: 'low',
        seed: SEED,
      } as VideoGenerationParams)

      let res: Awaited<ReturnType<typeof runGraph>>
      try {
        res = await runGraph('minimax-h3', graph)
      } catch (e) {
        if (e instanceof ComfyDied) {
          console.log(`[dynvram] X minimax-h3 KILLED ComfyUI. Last log:\n${e.tail.slice(-1500)}`)
          const back = await restartComfy()
          console.log(`[dynvram] restart after h3: ${back ? 'ComfyUI is back' : 'FAILED — pod is stranded'}`)
        }
        throw e
      }

      // The output KEY does not identify the medium — core SaveVideo reports its
      // mp4 under `images`. Go by the extension, exactly as resolveOutputMedia does.
      const files = Object.values(res.outputs).flatMap((o) => o.images ?? o.gifs ?? [])
      const clip = files.find((f) => /\.(mp4|webm|mkv)$/i.test(f.filename))
      expect(clip, `no video in outputs (${files.map((f) => f.filename).join(', ')})`).toBeTruthy()
      const buf = await fetchOutput(clip!)
      expect(buf.subarray(4, 8).toString('ascii'), 'not an mp4').toBe('ftyp')
      console.log(
        `[dynvram] OK minimax-h3 — ${clip!.filename} ${(buf.length / 1e6).toFixed(2)} MB in ${(res.ms / 1000).toFixed(0)}s`,
      )
    },
    RENDER_TIMEOUT_MS + 5 * 60_000,
  )
})
