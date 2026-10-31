/**
 * ComfyUI compatibility check — run it before AND after bumping the ComfyUI pin.
 *
 *   cd app
 *   LIVE_RENDER=1 COMPAT_OUT=<dir> node_modules/.bin/vitest run src/lib/workflows/comfyui-compat.live.test.ts
 *
 * Every run writes `<COMPAT_OUT>/v<version>/`, where the version is whatever
 * ComfyUI reports, so the two halves of an A/B can never be mislabelled.
 * Once two versions are there, the last test writes `<COMPAT_OUT>/compare.html`:
 * every leg side by side, with the metrics and the pixel difference between them.
 *
 * Three layers, cheapest first:
 *  1. **Schema** — every node class the app names is registered, and none of them
 *     grew a required input, lost an output or flipped its dropdown format since
 *     the previous version's snapshot. Six components read
 *     `input.required.<x>[0]` directly and would go silently empty on a flip.
 *  2. **Validation** — every graph the app can build, for every family and mode,
 *     goes through ComfyUI's own validator with each file name swapped for a
 *     sentinel, so any error that does not name the sentinel is a real break.
 *     No weights needed. Nothing real runs: ComfyUI does queue a prompt whose
 *     outputs only PARTLY fail validation, but with every file a sentinel it dies
 *     at its first loader — and that execution error is checked the same way.
 *  3. **Renders** — a fixed-seed matrix over the families that actually ship
 *     most (`COMPAT_LEGS` picks a subset). Each output is measured: luminance
 *     (a black frame is ~2.5), mean RGB channel spread (the fp8 corruption), and
 *     for H3 the audio's stereo width and SNR, which is what regressed last time.
 *
 * The seed is FIXED, unlike every other live test here, because comparing two
 * versions needs byte-identical graphs. ComfyUI's execution cache would serve a
 * repeat from the same process, so run it once per ComfyUI start — a version
 * switch restarts ComfyUI anyway.
 *
 * Needs ffmpeg/ffprobe on PATH for the metrics.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { workflows, getWorkflow } from './index'
import { getVideoWorkflow } from './video-index'
import { emptyTimeline } from './director-timeline'
import type { GenerationParams } from '@/types/workflow'
import type { ComfyUIPrompt } from '@/types/comfyui'
import type { VideoGenerationParams } from '@/types/video-workflow'

const LIVE = process.env.LIVE_RENDER === '1'
const COMFY = process.env.COMFYUI_URL ?? 'http://localhost:8188'
const OUT = process.env.COMPAT_OUT ?? path.join(os.tmpdir(), 'raccoon-compat')
const SEED = Number(process.env.COMPAT_SEED ?? 20260930)
const PICKED = process.env.COMPAT_LEGS?.split(',').map((s) => s.trim()).filter(Boolean)
const SOURCE = path.join(OUT, 'source.png')
const SOURCE_NAME = 'raccoon-compat-source.png'
/** A 1.6x centre crop of the source: the FL2V end frame, i.e. a push-in. */
const END = path.join(OUT, 'source-end.png')
/** Only 10Eros Max is on the dev box; `base` for an install with the stock DiT. */
const H3_CHECKPOINT = (process.env.COMPAT_H3_CHECKPOINT ?? 'eros') as 'base' | 'eros'
const SENTINEL = '__raccoon_compat__'

type Graph = ComfyUIPrompt
type Metrics = Record<string, number | string | boolean | null>
interface LegResult { ok: boolean; file?: string; output?: string; seconds?: number; metrics?: Metrics; error?: string }
interface RunResults { version: string; seed: number; legs: Record<string, LegResult> }
interface OutFile { filename: string; subfolder: string; type: string }

// ── ComfyUI ──────────────────────────────────────────────────────────────────

async function comfy<T>(p: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${COMFY}${p}`, init)
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status} ${(await r.text()).slice(0, 500)}`)
  return (await r.json()) as T
}

const postPrompt = (prompt: Graph) =>
  fetch(`${COMFY}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, client_id: 'raccoon-compat' }),
  })

async function upload(file: string, name: string): Promise<string> {
  const form = new FormData()
  form.append('image', new Blob([fs.readFileSync(file)], { type: 'image/png' }), name)
  form.append('overwrite', 'true')
  const r = await comfy<{ name: string; subfolder?: string }>('/upload/image', { method: 'POST', body: form })
  return r.subfolder ? `${r.subfolder}/${r.name}` : r.name
}

/** Queue a graph and wait for it; returns every file it saved to `output`. */
async function render(graph: Graph, timeoutMs: number): Promise<OutFile[]> {
  const res = await postPrompt(graph)
  const body = (await res.json()) as { prompt_id?: string }
  if (!res.ok || !body.prompt_id) throw new Error(`submit ${res.status}: ${JSON.stringify(body).slice(0, 1500)}`)
  const id = body.prompt_id
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs / 1000}s`)
    await new Promise((r) => setTimeout(r, 2000))
    const entry = (await comfy<Record<string, { status?: { status_str?: string; completed?: boolean }; outputs?: Record<string, Record<string, unknown>> }>>(`/history/${id}`))[id]
    if (!entry) continue
    if (entry.status?.status_str === 'error') throw new Error(JSON.stringify(entry.status).slice(0, 1500))
    if (!entry.status?.completed) continue
    return Object.values(entry.outputs ?? {})
      .flatMap((o) => Object.values(o).filter(Array.isArray).flat() as OutFile[])
      .filter((f) => f?.filename && f.type === 'output')
  }
}

async function download(f: OutFile, to: string) {
  const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder, type: f.type })
  const r = await fetch(`${COMFY}/view?${q}`)
  if (!r.ok) throw new Error(`view ${f.filename}: HTTP ${r.status}`)
  fs.writeFileSync(to, Buffer.from(await r.arrayBuffer()))
}

// ── metrics (ffmpeg) ─────────────────────────────────────────────────────────

const ff = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', ...args], { maxBuffer: 512 * 1024 * 1024 })

/** One frame as rgb24, area-scaled to size×size. `at` in seconds, for video. */
const rgbFrame = (file: string, size: number, at?: number) =>
  ff([...(at == null ? [] : ['-ss', at.toFixed(2)]), '-i', file, '-frames:v', '1',
    '-vf', `scale=${size}:${size}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])

const gray = (rgb: Buffer, i: number) => 0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2]

/** Mean luminance and mean per-pixel RGB spread (max−min channel). */
function pixelStats(rgb: Buffer) {
  let luma = 0
  let spread = 0
  for (let i = 0; i < rgb.length; i += 3) {
    luma += gray(rgb, i)
    spread += Math.max(rgb[i], rgb[i + 1], rgb[i + 2]) - Math.min(rgb[i], rgb[i + 1], rgb[i + 2])
  }
  const n = rgb.length / 3
  return { luma: +(luma / n).toFixed(1), spread: +(spread / n).toFixed(1) }
}

/** Mean |gray difference| of two same-sized rgb24 frames, 0–255. */
function grayDiff(a: Buffer, b: Buffer) {
  let d = 0
  for (let i = 0; i < a.length; i += 3) d += Math.abs(gray(a, i) - gray(b, i))
  return +(d / (a.length / 3)).toFixed(2)
}

interface Probe { streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string; channels?: number; sample_rate?: string }[]; format: { duration?: string } }
const probe = (file: string) =>
  JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString()) as Probe

/**
 * Stereo width and SNR, the two numbers that separated the v0.30 → v0.34 audio
 * change: width is side/mid energy in dB (it NARROWED on 0.34, worst on the
 * Fast tier), SNR the loud 95th-percentile 50 ms window over the quiet 10th —
 * peak-referenced, so a clip that is merely quieter does not read as cleaner.
 */
function audioStats(file: string) {
  const pcm = ff(['-i', file, '-vn', '-ac', '2', '-ar', '32000', '-f', 'f32le', '-'])
  const s = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length))
  const WIN = 1600
  let mid = 0
  let side = 0
  let all = 0
  let acc = 0
  let k = 0
  const windows: number[] = []
  for (let i = 0; i + 1 < s.length; i += 2) {
    const m = (s[i] + s[i + 1]) / 2
    const d = (s[i] - s[i + 1]) / 2
    mid += m * m
    side += d * d
    const e = (s[i] * s[i] + s[i + 1] * s[i + 1]) / 2
    all += e
    acc += e
    if (++k === WIN) { windows.push(Math.sqrt(acc / WIN)); acc = 0; k = 0 }
  }
  windows.sort((a, b) => a - b)
  const at = (p: number) => windows[Math.min(windows.length - 1, Math.floor(p * windows.length))] ?? 0
  const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9))
  return {
    rmsDb: +db(Math.sqrt(all / Math.max(1, s.length / 2))).toFixed(2),
    widthDb: +(10 * Math.log10(Math.max(side, 1e-12) / Math.max(mid, 1e-12))).toFixed(2),
    snrDb: +(db(at(0.95)) - db(at(0.1))).toFixed(2),
  }
}

/** Sample points for a clip: just in, the middle, just before the end. */
const videoTimes = (duration: number) => [0.5, duration / 2, Math.max(0, duration - 0.3)]

function measure(file: string): Metrics {
  if (file.endsWith('.png')) {
    return { bytes: fs.statSync(file).size, ...pixelStats(rgbFrame(file, 256)) }
  }
  const p = probe(file)
  const v = p.streams.find((s) => s.codec_type === 'video')
  const a = p.streams.find((s) => s.codec_type === 'audio')
  const duration = Number(p.format.duration ?? 0)
  const frames = videoTimes(duration).map((t) => pixelStats(rgbFrame(file, 256, t)))
  return {
    bytes: fs.statSync(file).size,
    size: `${v?.width}x${v?.height}`,
    fps: v?.r_frame_rate ?? null,
    duration: +duration.toFixed(3),
    luma: +(frames.reduce((x, f) => x + f.luma, 0) / frames.length).toFixed(1),
    spread: +(frames.reduce((x, f) => x + f.spread, 0) / frames.length).toFixed(1),
    audio: a ? `${a.channels}ch ${a.sample_rate} Hz` : null,
    ...(a ? audioStats(file) : {}),
  }
}

// ── results ──────────────────────────────────────────────────────────────────

let runDir = ''
let version = ''
let objectInfo: Record<string, NodeSchema> = {}
let freed = false

const resultsFile = () => path.join(runDir, 'results.json')
const readResults = (dir = runDir): RunResults | null => {
  const f = path.join(dir, 'results.json')
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as RunResults) : null
}
function saveLeg(id: string, r: LegResult) {
  const all = readResults() ?? { version, seed: SEED, legs: {} }
  all.legs[id] = r
  fs.writeFileSync(resultsFile(), JSON.stringify(all, null, 2))
}

/** Version dirs under OUT, oldest version first. */
function versionDirs(): string[] {
  if (!fs.existsSync(OUT)) return []
  const key = (d: string) => d.slice(1).split('.').map((n) => n.padStart(6, '0')).join('.')
  return fs.readdirSync(OUT)
    .filter((d) => /^v\d+\.\d+\.\d+/.test(d) && fs.existsSync(path.join(OUT, d, 'object_info.json')))
    .sort((a, b) => key(a).localeCompare(key(b)))
}

// ── the classes the app names ────────────────────────────────────────────────

interface NodeSchema { input?: { required?: Record<string, unknown[]>; optional?: Record<string, unknown[]> }; output?: string[] }

/** Every `class_type` literal in the builders and the shipped graph templates. */
function usedClasses(): string[] {
  const root = path.resolve('src') // vitest runs from app/
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(p)
    }
  }
  walk(path.join(root, 'lib'))
  const tplDir = path.resolve(root, '../workflows')
  files.push(...fs.readdirSync(tplDir).filter((f) => f.endsWith('.json')).map((f) => path.join(tplDir, f)))
  const names = new Set<string>()
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/class_type['"]?\s*:\s*['"]([^'"]+)['"]/g)) names.add(m[1])
  }
  return [...names].sort()
}

/** `[[...options], cfg]` is the legacy dropdown; `['COMBO', { options }]` the V3 one. */
const comboStyle = (spec: unknown[] | undefined) =>
  !spec ? null : Array.isArray(spec[0]) ? 'legacy' : spec[0] === 'COMBO' ? 'v3' : null

// ── graphs, for the validation pass ──────────────────────────────────────────

const FILE_RE = /\.(safetensors|sft|ckpt|pt|pth|onnx|gguf|bin|png|jpe?g|webp|mp4|webm|mov|wav|mp3|flac)( \[(input|output|temp)\])?$/i

function withSentinels(graph: Graph): Graph {
  const g = structuredClone(graph)
  for (const node of Object.values(g)) {
    for (const [k, v] of Object.entries(node.inputs)) {
      if (typeof v === 'string' && FILE_RE.test(v)) node.inputs[k] = `${SENTINEL}${v.match(FILE_RE)![0].split(' ')[0]}`
    }
  }
  return g
}

const X = (ext = 'png') => `sentinel.${ext}`

function allGraphs(): [string, Graph][] {
  const out: [string, Graph][] = []
  const base: GenerationParams = { prompt: 'a portrait', negativePrompt: 'blurry', width: 832, height: 1216, seed: 1 }
  const imageVariants: [string, Partial<GenerationParams>][] = [
    ['default', {}],
    ['bare', { upscale: false, detailer: false }],
    ['swap', { faceSwap: true, inputImage: X() }],
    ['swap-hyperswap', { faceSwap: true, inputImage: X(), faceSwapModel: 'hyperswap_1c_256.onnx' }],
    ['swap-boost-alphaface', { faceSwap: true, inputImage: X(), faceSwapModel: 'alphaface_256.onnx', faceSwapPixelBoost: true }],
    ['img2img', { baseImage: X(), editMode: 'img2img', denoise: 0.6 }],
    ['inpaint', { baseImage: X(), editMode: 'inpaint', maskImage: X(), denoise: 0.8 }],
    ['outpaint', { baseImage: X(), editMode: 'outpaint', outpaint: { left: 64, top: 0, right: 64, bottom: 0, feather: 24 } }],
    ['tiled-vae', { tiledVaeDecode: true, tiledVaeTileSize: 512 }],
    ['controlnet', { controlNet: { mode: 'depth', image: X(), strength: 0.8 } }],
    ['ipadapter', { ipAdapter: { image: X(), weight: 0.7 } }],
    ['enhancer', { promptEnhancer: true }],
    ['expert', { expertMode: true }],
  ]
  for (const wf of workflows) {
    for (const [name, over] of imageVariants) out.push([`${wf.id}/${name}`, wf.buildPrompt({ ...base, ...over })])
  }


  const video = (id: string, over: Partial<VideoGenerationParams>): Graph => {
    const wf = getVideoWorkflow(id)!
    return wf.buildPrompt({ ...wf.defaultParams, prompt: 'a raccoon', seed: 1, durationSeconds: 5, ...over } as VideoGenerationParams)
  }
  const i2v = { mode: 'i2v' as const, inputImage: X(), inputImageWidth: 832, inputImageHeight: 1216 }
  const timeline = emptyTimeline(5, 30)
  timeline.segments = [
    { id: 's1', startSec: 0, lengthSec: 2.5, prompt: 'push in', file: X(), strength: 1, width: 832, height: 1216 },
    { id: 's2', startSec: 2.5, lengthSec: 2.5, prompt: 'pull back', file: X(), strength: 1, width: 832, height: 1216 },
  ]
  const videoVariants: [string, string, Partial<VideoGenerationParams>][] = [
    ['ltx23', 't2v', { mode: 't2v' }],
    ['ltx23', 'i2v', i2v],
    ['ltx23', 'i2v-faceid', { ...i2v, faceId: true, faceIdImage: X() }],
    ['ltx23-director', 'director', { mode: 'director', timeline }],
    ['minimax-h3', 't2v', { mode: 't2v' }],
    ['minimax-h3', 't2v-draft', { mode: 't2v', turbo: 'draft' }],
    ['minimax-h3', 't2v-fast', { mode: 't2v', turbo: 'fast' }],
    ['minimax-h3', 'i2v', i2v],
    ['minimax-h3', 'fl2v', { ...i2v, endImage: X() }],
    ['minimax-h3', 'l2v', { mode: 'i2v', endImage: X(), endImageWidth: 832, endImageHeight: 1216 }],
    ['minimax-h3', 'ref2v-roles', { mode: 'ref2v', refImages: [X(), X()], refImageRoles: ['character', 'outfit'] }],
    ['minimax-h3', 'continue', { mode: 't2v', continueFrom: `h3/${X('mp4')}` }],
    ['minimax-h3', 'eros-i2v', { ...i2v, h3Checkpoint: 'eros' }],
    ['minimax-h3', 'finishing', { mode: 't2v', rife: true, filmGrain: true, sharpen: true, upscale: true, realismLora: true }],
    ['minimax-h3', 'seed-hunt', { mode: 't2v', seedHunt: true }],
  ]
  for (const [id, name, over] of videoVariants) out.push([`${id}/${name}`, video(id, over)])
  return out
}

// ── the render matrix ────────────────────────────────────────────────────────

const PORTRAIT = 'close-up portrait photograph of a woman with freckles and auburn hair, natural skin texture, 50mm lens, soft window light'
const MUSIC = 'a street musician plays an acoustic guitar and sings softly under a streetlight on a rainy night, cars pass, rain patters on an umbrella'

interface Ctx { source: string; end: string; sourceW: number; sourceH: number; outputOf: (leg: string) => string }
/** `source`: the leg reads the portrait the z-image leg saved as source.png. */
interface Leg { id: string; kind: 'image' | 'video'; needsSource?: boolean; build: (c: Ctx) => Graph }

const image = (id: string, wf: string, over: Partial<GenerationParams> = {}, needsSource = false): Leg => ({
  id,
  kind: 'image',
  needsSource,
  build: (c) => getWorkflow(wf)!.buildPrompt({
    prompt: PORTRAIT, negativePrompt: 'blurry, watermark, deformed', width: 832, height: 1216, seed: SEED,
    ...over, ...(needsSource ? { inputImage: c.source } : {}),
  }),
})

const h3 = (id: string, over: (c: Ctx) => Partial<VideoGenerationParams>, needsSource = false): Leg => ({
  id,
  kind: 'video',
  needsSource,
  build: (c) => getVideoWorkflow('minimax-h3')!.buildPrompt({
    ...getVideoWorkflow('minimax-h3')!.defaultParams,
    prompt: MUSIC, mode: 't2v', durationSeconds: 5, seed: SEED, vramMode: 'low', h3Checkpoint: H3_CHECKPOINT, ...over(c),
  } as VideoGenerationParams),
})

const i2vFrom = (c: Ctx) => ({ mode: 'i2v' as const, inputImage: c.source, inputImageWidth: c.sourceW, inputImageHeight: c.sourceH })

/**
 * Krea2 runs first: its fp8_scaled weights are the DynamicVRAM corruption case,
 * which needs VRAM pressure — so it goes before the ONNX face-swap stack is
 * resident, and never gets a swap of its own (a swap poisons every later Krea2
 * render until restart; see claude-context).
 */
const LEGS: Leg[] = [
  image('krea2-turbo', 'krea2-turbo'),
  image('krea2-enhancer', 'krea2-turbo', { promptEnhancer: true }),
  image('anima-turbo', 'anima-turbo', { prompt: `1girl, ${PORTRAIT}` }),
  // The Illustrious base is not what installs carry; the form's model picker
  // offers any installed checkpoint, which is exactly this override.
  image('illustrious', 'illustrious', {
    prompt: `1girl, ${PORTRAIT}`,
    ariaModel: process.env.COMPAT_ILLUSTRIOUS ?? 'waiMatureIllustrious_v30.safetensors',
  }),
  image('z-image', 'z-image-turbo'),
  // Swaps the saved portrait onto a different woman: ReActor + GPEN + detailer.
  image('z-image-swap', 'z-image-turbo', {
    prompt: 'close-up portrait photograph of a woman with dark hair, natural skin texture, 50mm lens, overcast light',
    seed: SEED + 1,
    faceSwap: true,
  }, true),
  h3('h3-t2v', () => ({})),
  // The whole finishing chain rides on one leg: RIFE, grain, RCAS sharpen, RTX VSR.
  h3('h3-i2v-finishing', (c) => ({ ...i2vFrom(c), prompt: 'she turns to the window and smiles, soft rain outside', rife: true, filmGrain: true, sharpen: true, upscale: true }), true),
  h3('h3-fl2v', (c) => ({ ...i2vFrom(c), endImage: c.end, endImageWidth: c.sourceW, endImageHeight: c.sourceH, prompt: 'the camera slowly pushes in on her face as she looks up' }), true),
  h3('h3-ref2v', (c) => ({
    mode: 'ref2v', refImages: [c.source], refImageRoles: ['character'],
    prompt: 'the woman from <Picture 1> walks through a sunny park and waves at the camera',
  }), true),
  h3('h3-continue', (c) => ({ continueFrom: c.outputOf('h3-t2v'), prompt: `${MUSIC}, the camera slowly pulls back` })),
]

// ── tests ────────────────────────────────────────────────────────────────────

describe.skipIf(!LIVE)('ComfyUI compatibility', () => {
  beforeAll(async () => {
    const stats = await comfy<{ system: { comfyui_version: string } }>('/system_stats')
    version = stats.system.comfyui_version
    runDir = path.join(OUT, `v${version}`)
    fs.mkdirSync(runDir, { recursive: true })
    objectInfo = await comfy<Record<string, NodeSchema>>('/object_info')
    fs.writeFileSync(path.join(runDir, 'object_info.json'), JSON.stringify(objectInfo))
    console.log(`[compat] ComfyUI ${version}: ${Object.keys(objectInfo).length} node classes -> ${runDir}`)
  }, 120_000)

  it('no custom node pack failed to import', async (ctx) => {
    const log = (await comfy<{ entries: { m: string }[] }>('/internal/logs/raw')).entries.map((e) => e.m).join('')
    if (!log.includes('Import times for custom nodes')) {
      ctx.skip('the import report has scrolled out of the log buffer — restart ComfyUI and run again')
    }
    const failed = log.split('\n').filter((l) => l.includes('IMPORT FAILED'))
    expect(failed).toEqual([])
  })

  it('every node class the app names is registered', () => {
    const missing = usedClasses().filter((c) => !objectInfo[c])
    expect(missing).toEqual([])
  })

  it('no class the app uses broke its schema since the previous version', (ctx) => {
    const prev = versionDirs().filter((d) => d !== `v${version}`).at(-1)
    if (!prev) ctx.skip('no earlier snapshot to diff against — run this on the old version first')
    const before = JSON.parse(fs.readFileSync(path.join(OUT, prev!, 'object_info.json'), 'utf8')) as Record<string, NodeSchema>
    const breaking: string[] = []
    const notes: string[] = []
    for (const c of usedClasses()) {
      const a = before[c]
      const b = objectInfo[c]
      if (!a || !b) continue
      const ins = (s: NodeSchema) => ({ ...(s.input?.required ?? {}), ...(s.input?.optional ?? {}) })
      const [ia, ib] = [ins(a), ins(b)]
      for (const k of Object.keys(b.input?.required ?? {})) {
        if (!(k in ia)) breaking.push(`${c}: new required input '${k}'`)
      }
      for (const k of Object.keys(ia)) {
        if (!Array.isArray(ia[k]) || !Array.isArray(ib[k])) { if (!(k in ib)) notes.push(`${c}: input '${k}' removed`); continue }
        if (!(k in ib)) notes.push(`${c}: input '${k}' removed`)
        else if (comboStyle(ia[k]) === 'legacy' && comboStyle(ib[k]) === 'v3') breaking.push(`${c}.${k}: dropdown moved to the V3 format`)
        else if (!Array.isArray(ia[k][0]) && ia[k][0] !== ib[k][0]) notes.push(`${c}.${k}: type ${String(ia[k][0])} -> ${String(ib[k][0])}`)
      }
      for (const k of Object.keys(ib)) if (!(k in ia)) notes.push(`${c}: new optional input '${k}'`)
      const [oa, ob] = [a.output ?? [], b.output ?? []]
      oa.forEach((t, i) => { if (ob[i] !== t) breaking.push(`${c}: output ${i} was ${t}, now ${ob[i] ?? 'gone'}`) })
      if (ob.length > oa.length) notes.push(`${c}: gained outputs ${ob.slice(oa.length).join(', ')}`)
    }
    fs.writeFileSync(path.join(runDir, 'schema-diff.json'), JSON.stringify({ against: prev, breaking, notes }, null, 2))
    console.log(`[compat] schema vs ${prev}: ${breaking.length} breaking, ${notes.length} notes\n  ${[...breaking, ...notes].join('\n  ')}`)
    expect(breaking).toEqual([])
  })

  it('every graph the app can build passes ComfyUI validation', async () => {
    const q = await comfy<{ queue_running: unknown[]; queue_pending: unknown[] }>('/queue')
    expect(q.queue_running.length + q.queue_pending.length, 'ComfyUI is busy — let the queue drain first').toBe(0)
    const failures: string[] = []
    const queued: [string, string][] = []
    for (const [name, graph] of allGraphs()) {
      const res = await postPrompt(withSentinels(graph))
      const body = (await res.json()) as { prompt_id?: string; error?: unknown; node_errors?: Record<string, { errors: unknown[]; class_type: string }> }
      // ComfyUI queues a prompt when only SOME of its outputs fail (e.g. a
      // PreviewAny of a constant), and reports the rest in node_errors all the same.
      if (res.ok && body.prompt_id) queued.push([name, body.prompt_id])
      const nodeErrors = Object.entries(body.node_errors ?? {})
      if (!res.ok && !nodeErrors.length) failures.push(`${name}: ${JSON.stringify(body.error).slice(0, 400)}`)
      for (const [id, n] of nodeErrors) {
        for (const e of n.errors) if (!JSON.stringify(e).includes(SENTINEL)) failures.push(`${name}: ${id} ${n.class_type} ${JSON.stringify(e).slice(0, 400)}`)
      }
    }
    // Whatever got queued can only die at its first loader, since every file is
    // a sentinel — so an execution error that does NOT name it is a real break
    // in a node the validator waved through.
    for (const [name, id] of queued) {
      for (let tries = 0; ; tries++) {
        const entry = (await comfy<Record<string, { status?: { completed?: boolean; status_str?: string; messages?: [string, unknown][] } }>>(`/history/${id}`))[id]
        if (entry?.status?.status_str) {
          const err = entry.status.messages?.find((m) => m[0] === 'execution_error')
          if (err && !JSON.stringify(err[1]).includes(SENTINEL)) failures.push(`${name}: execution error ${JSON.stringify(err[1]).slice(0, 400)}`)
          break
        }
        if (tries > 240) { failures.push(`${name}: still running after 2 min`); break }
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    expect(failures).toEqual([])
  }, 600_000)

  for (const leg of LEGS) {
    it.skipIf(PICKED && !PICKED.includes(leg.id))(`renders ${leg.id}`, async () => {
      const ctx: Ctx = {
        source: '',
        end: '',
        sourceW: 0,
        sourceH: 0,
        outputOf: (id) => {
          const out = readResults()?.legs[id]?.output
          if (!out) throw new Error(`${leg.id} needs ${id} rendered first in this version`)
          return out
        },
      }
      if (leg.needsSource) {
        if (!fs.existsSync(SOURCE)) throw new Error(`${leg.id} needs ${SOURCE} — render z-image first`)
        const png = fs.readFileSync(SOURCE)
        ctx.source = await upload(SOURCE, SOURCE_NAME)
        ctx.sourceW = png.readUInt32BE(16) // IHDR width/height
        ctx.sourceH = png.readUInt32BE(20)
        if (!fs.existsSync(END)) {
          ff(['-i', SOURCE, '-vf', `crop=iw/1.6:ih/1.6,scale=${ctx.sourceW}:${ctx.sourceH}:flags=lanczos`, '-y', END])
        }
        ctx.end = await upload(END, 'raccoon-compat-source-end.png')
      }
      if (leg.kind === 'video' && !freed) {
        // Drop every image model before ~40 GB of video weights land.
        await fetch(`${COMFY}/free`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) })
        freed = true
      }
      const started = Date.now()
      try {
        const files = await render(leg.build(ctx), leg.kind === 'video' ? 30 * 60_000 : 10 * 60_000)
        const ext = leg.kind === 'video' ? '.mp4' : '.png'
        const picked = files.filter((f) => f.filename.endsWith(ext))
        expect(picked.length, `${leg.id} saved no ${ext}`).toBeGreaterThan(0)
        // The final stage is the biggest file: an upscaled still, a delivered clip.
        const tmp = picked.map((f, i) => ({ f, p: path.join(runDir, `${leg.id}.${i}${ext}`) }))
        for (const t of tmp) await download(t.f, t.p)
        tmp.sort((a, b) => fs.statSync(b.p).size - fs.statSync(a.p).size)
        const file = path.join(runDir, `${leg.id}${ext}`)
        fs.renameSync(tmp[0].p, file)
        for (const t of tmp.slice(1)) fs.rmSync(t.p)
        if (leg.id === 'z-image' && !fs.existsSync(SOURCE)) fs.copyFileSync(file, SOURCE)
        const metrics = measure(file)
        const seconds = +((Date.now() - started) / 1000).toFixed(1)
        const out = tmp[0].f.subfolder ? `${tmp[0].f.subfolder}/${tmp[0].f.filename}` : tmp[0].f.filename
        saveLeg(leg.id, { ok: true, file: path.basename(file), output: out, seconds, metrics })
        console.log(`[compat] ${leg.id}: ${seconds}s ${JSON.stringify(metrics)}`)
        // A pure black frame is ~2.5; the fp8 corruption pushes spread past ~90.
        expect(metrics.luma as number, `${leg.id} rendered black`).toBeGreaterThan(15)
      } catch (err) {
        saveLeg(leg.id, { ok: false, seconds: +((Date.now() - started) / 1000).toFixed(1), error: String(err).slice(0, 1500) })
        throw err
      }
    }, 35 * 60_000)
  }

  it('writes the side-by-side page once two versions have rendered', (ctx) => {
    const dirs = versionDirs().filter((d) => readResults(path.join(OUT, d)))
    if (dirs.length < 2) ctx.skip('only one version has rendered so far')
    const [a, b] = [dirs[0], dirs.at(-1)!]
    const [ra, rb] = [readResults(path.join(OUT, a))!, readResults(path.join(OUT, b))!]
    const rows: string[] = []
    const summary: Record<string, unknown> = {}
    for (const leg of LEGS) {
      const [la, lb] = [ra.legs[leg.id], rb.legs[leg.id]]
      if (!la && !lb) continue
      let diff: number[] = []
      if (la?.ok && lb?.ok) {
        const [fa, fb] = [path.join(OUT, a, la.file!), path.join(OUT, b, lb.file!)]
        diff = leg.kind === 'image'
          ? [grayDiff(rgbFrame(fa, 64), rgbFrame(fb, 64))]
          : videoTimes(Math.min(Number(la.metrics?.duration), Number(lb.metrics?.duration)))
            .map((t) => grayDiff(rgbFrame(fa, 64, t), rgbFrame(fb, 64, t)))
      }
      summary[leg.id] = { [a]: la, [b]: lb, pixelDiff: diff }
      const cell = (dir: string, l?: LegResult) => {
        if (!l) return '<td class="miss">not rendered</td>'
        if (!l.ok) return `<td class="fail"><b>FAILED</b><pre>${esc(l.error ?? '')}</pre></td>`
        const src = `${dir}/${l.file}`
        const media = leg.kind === 'image'
          ? `<a href="${src}" target="_blank"><img src="${src}" loading="lazy"></a>`
          : `<video src="${src}" controls preload="metadata"></video>`
        return `<td>${media}<div class="m">${l.seconds}s · ${esc(Object.entries(l.metrics ?? {}).map(([k, v]) => `${k} ${v}`).join(' · '))}</div></td>`
      }
      rows.push(`<tr><th>${leg.id}<div class="d">${diff.length ? `pixel diff ${diff.join(' / ')}` : ''}</div></th>${cell(a, la)}${cell(b, lb)}</tr>`)
    }
    fs.writeFileSync(path.join(OUT, 'compare.json'), JSON.stringify(summary, null, 2))
    fs.writeFileSync(path.join(OUT, 'compare.html'), `<!doctype html><meta charset="utf-8"><title>ComfyUI ${a} vs ${b}</title>
<style>
body{margin:0;padding:24px;background:#111214;color:#e7e7ea;font:14px system-ui,sans-serif}
h1{font-size:20px}p{color:#a2a2ab;max-width:70ch}
table{border-collapse:collapse;width:100%}th,td{border-top:1px solid #2a2b30;padding:12px;vertical-align:top;text-align:left}
th{width:14%}td{width:43%}img,video{width:100%;max-height:70vh;object-fit:contain;background:#000;border-radius:6px}
.m,.d{color:#a2a2ab;font-size:12px;margin-top:6px}.fail{color:#ff8a80}.miss{color:#6f6f78}pre{white-space:pre-wrap;font-size:11px}
</style>
<h1>ComfyUI ${a} (left) vs ${b} (right) — seed ${ra.seed}</h1>
<p>Same graph, same seed, same weights; only ComfyUI changed. Pixel diff is the mean absolute
grey difference at 64×64 (0 = identical, 255 = inverted), one number per image or per sampled
video frame. Luma ≈2.5 is a black frame; spread past ~90 is the fp8 corruption. For H3,
widthDb is side/mid energy (more negative = narrower stereo) and snrDb the loud-over-quiet
ratio — listen to both before trusting either.</p>
<table>${rows.join('\n')}</table>`)
    console.log(`[compat] wrote ${path.join(OUT, 'compare.html')}`)
  }, 300_000)
})

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
