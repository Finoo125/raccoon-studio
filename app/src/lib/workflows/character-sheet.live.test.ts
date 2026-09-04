/**
 * Live character-sheet probe: can the shipped image families produce a sheet
 * usable as a MiniMax H3 reference?
 *
 *   cd app
 *   LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/character-sheet.live.test.ts
 *
 * Three families, one character brief, one render each. Needs the three Civitai
 * character-sheet LoRAs in `models/loras/`; each leg self-skips without its file
 * so a partial install still reports on what it has.
 *
 * Layout target comes from MiniMax's own reference guidance: a few LARGE clearly
 * separated views beat a dense grid of small panels, so the brief asks for three
 * full-body views, not a twelve-cell turnaround.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { zImageTurboWorkflow } from './z-image-turbo'
import { animaTurboWorkflow } from './anima'
import { krea2TurboWorkflow } from './krea2'
import { minimaxH3Workflow } from './minimax-h3'
import type { ComfyUIPrompt } from '@/types/comfyui'
import { execFileSync } from 'node:child_process'
import type { GenerationParams, WorkflowDefinition } from '@/types/workflow'
import type { VideoGenerationParams } from '@/types/video-workflow'

const LIVE = process.env.LIVE_RENDER === '1'
const SEED = Number(process.env.LIVE_SEED ?? Date.now() % 9_000_000_000)
const RENDER_TIMEOUT_MS = 15 * 60_000
const POLL_MS = 2_000

/** Where the renders are copied for eyeballing. */
const COLLECT = process.env.SHEET_OUT ?? ''

/** One brief, deliberately specific — vague characters hide inconsistency. */
const CHARACTER =
  'a woman in her late 20s, short copper-red hair shaved one side, freckles, ' +
  'olive-green flight jacket, grey t-shirt, black cargo trousers, brown boots'

/**
 * Kept deliberately terse. Z-Image Turbo renders a PURE BLACK image once the
 * prompt passes roughly 430 characters — measured on this stack: 430 renders,
 * 440 is black, with no error from ComfyUI and `status_str: success`. It is a
 * text-encoder cliff, so the real unit is tokens and the char count above is
 * only a rule of thumb. Every leg shares this budget so the comparison is fair.
 */
const LAYOUT =
  'three full-body views: front, side, back, neutral A-pose, ' +
  'identical scale and lighting, plain light grey background'

interface Leg {
  label: string
  workflow: WorkflowDefinition
  lora: string
  prompt: string
  extra?: Partial<GenerationParams>
}

const LEGS: Leg[] = [
  {
    label: 'z-image',
    workflow: zImageTurboWorkflow,
    lora: 'CharacterDesign-IZT-V1.safetensors',
    prompt: `CharacterDesignIZT, character design sheet of ${CHARACTER}, ${LAYOUT}`,
  },
  {
    label: 'anima',
    workflow: animaTurboWorkflow,
    lora: 'CharacterSheet-Anima-v1.safetensors',
    prompt:
      '1girl, multiple views, standing, full body, reference sheet, turnaround, ' +
      `${CHARACTER}, ${LAYOUT}`,
  },
  {
    label: 'krea2',
    workflow: krea2TurboWorkflow,
    lora: 'CharacterDesign-KREA2_v1.safetensors',
    prompt: `Character design sheet of ${CHARACTER}, ${LAYOUT}`,
    // Krea2 defaults to a hires pass; off so this measures the sampler alone
    // and every family costs roughly one render.
    extra: { upscale: false },
  },
]

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

describe.skipIf(!LIVE)('character sheet — live across families', () => {
  const env = { ...readEnvLocal(), ...process.env }
  const base = (env.COMFYUI_BASE_URL || 'http://localhost:8188').replace(/\/$/, '')
  const outputDir = env.COMFYUI_OUTPUT_DIR ?? ''
  let loraNames: string[] = []
  const inputDir = path.resolve(outputDir, '../input')
  /** Sheets produced by the legs below, keyed by family, for the H3 leg. */
  const sheets: Record<string, string | undefined> = {}

  async function render(label: string, wf: ComfyUIPrompt): Promise<string> {
    const res = await fetch(`${base}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: wf, client_id: 'raccoon-sheet-live' }),
    })
    const body = await res.text()
    expect(res.ok, `[${label}] POST /prompt rejected the graph: ${body}`).toBe(true)
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
      const hist = await fetch(`${base}/history/${prompt_id}`).then((r) => r.json()).catch(() => ({}))
      entry = (hist as Record<string, typeof entry>)[prompt_id]
      if (entry?.status?.completed !== undefined || entry?.status?.status_str === 'error') break
    }
    const secs = ((Date.now() - started) / 1000).toFixed(0)
    expect(entry, `[${label}] no /history entry after ${secs}s`).toBeTruthy()
    expect(
      entry!.status?.status_str,
      `[${label}] render failed: ${JSON.stringify(entry!.status?.messages)?.slice(0, 1500)}`,
    ).toBe('success')

    const images = Object.values(entry!.outputs ?? {}).flatMap((o) => o.images ?? [])
    expect(images.length, `[${label}] produced an image`).toBeGreaterThan(0)
    const onDisk = path.join(outputDir, images[0].subfolder, images[0].filename)
    expect(fs.existsSync(onDisk), `[${label}] output missing on disk: ${onDisk}`).toBe(true)
    if (COLLECT) {
      fs.mkdirSync(COLLECT, { recursive: true })
      fs.copyFileSync(onDisk, path.join(COLLECT, `${label}.png`))
    }
    console.log(`  [${label}] ${images[0].filename} in ${secs}s  seed=${SEED}`)
    return onDisk
  }

  beforeAll(async () => {
    const stats = await fetch(`${base}/system_stats`).catch(() => null)
    if (!stats?.ok) throw new Error(`ComfyUI is not answering on ${base} — start it first`)
    expect(fs.existsSync(outputDir), `COMFYUI_OUTPUT_DIR missing: ${outputDir}`).toBe(true)
    const info = (await (await fetch(`${base}/object_info/LoraLoader`)).json()) as {
      LoraLoader?: { input?: { required?: { lora_name?: [string[]] } } }
    }
    loraNames = (info.LoraLoader?.input?.required?.lora_name?.[0] ?? []).map((n) =>
      n.split(String.fromCharCode(92)).join('/'),
    )
    console.log(`  seed for this run: ${SEED}`)
  }, 60_000)

  for (const leg of LEGS) {
    it(`${leg.label}: renders a character sheet`, async () => {
      const listed = loraNames.find((n) => n === leg.lora || n.endsWith('/' + leg.lora))
      if (!listed) {
        console.log(`  [${leg.label}] SKIP — ${leg.lora} not in ComfyUI's LoRA list`)
        return
      }
      const params: GenerationParams = {
        ...leg.workflow.defaultParams,
        prompt: leg.prompt,
        // Wide, so three full-body views get real horizontal room each.
        width: 1344,
        height: 768,
        seed: SEED,
        upscale: false,
        detailer: false,
        promptEnhancer: false,
        loras: [{ name: listed, strength: 1 }],
        ...leg.extra,
      } as GenerationParams
      sheets[leg.label] = await render(leg.label, leg.workflow.buildPrompt(params))
    }, RENDER_TIMEOUT_MS)
  }

  /**
   * The point of the whole route: H3 reference mode reading a sheet the app
   * generated. Runs last so it can feed on the Krea 2 sheet the leg above just
   * rendered; self-skips if that leg did not produce one.
   *
   * The identity tell to look for is the shaved side of the head. It appears
   * only in the sheet's side and back panels, so a clip that reproduces it
   * cannot have got it from a front-facing still.
   */
  it('H3 reference mode renders a clip driven by the Krea 2 sheet', async () => {
    if (!sheets.krea2) {
      console.log('  [h3] SKIP - no Krea 2 sheet from the leg above')
      return
    }
    const staged = 'charsheet_krea2.png'
    fs.copyFileSync(sheets.krea2, path.join(inputDir, staged))

    const params = {
      ...minimaxH3Workflow.defaultParams,
      // The first line names the reference's job: MiniMax's guide is emphatic
      // that every reference needs a stated role, and an unnamed sheet is
      // measurably weaker than a named one.
      prompt:
        'Use <Picture 1>, the character sheet, to define the character’s face, hair and ' +
        'outfit; maintain her identity exactly. She walks slowly along a narrow city street ' +
        'at dusk, hands in her jacket pockets, glancing up at the buildings. Handheld camera ' +
        'follows behind her. Ambient street tone, distant traffic.',
      mode: 'ref2v',
      refImages: [staged],
      // ref2v has its own distillation - the fl2v LoRA is the wrong shape here.
      ref2vTurbo: true,
      turbo: 'draft',
      orientation: 'landscape',
      durationSeconds: 4,
      seed: SEED,
      vramMode: 'low',
    } as VideoGenerationParams

    const res = await fetch(`${base}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: minimaxH3Workflow.buildPrompt(params), client_id: 'raccoon-sheet-live' }),
    })
    const body = await res.text()
    expect(res.ok, `[h3] POST /prompt rejected the graph: ${body}`).toBe(true)
    const { prompt_id } = JSON.parse(body) as { prompt_id: string }

    const started = Date.now()
    type Hist = {
      status?: { completed?: boolean; status_str?: string; messages?: unknown[] }
      outputs?: Record<string, Record<string, { filename?: string; subfolder?: string }[]>>
    }
    let entry: Hist | undefined
    while (Date.now() - started < RENDER_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, 5000))
      const hist = await fetch(`${base}/history/${prompt_id}`).then((r) => r.json()).catch(() => ({}))
      entry = (hist as Record<string, Hist>)[prompt_id]
      if (entry?.status?.completed !== undefined || entry?.status?.status_str === 'error') break
    }
    const secs = ((Date.now() - started) / 1000).toFixed(0)
    expect(entry?.status?.status_str, `[h3] ${JSON.stringify(entry?.status?.messages)?.slice(0, 1500)}`).toBe('success')

    const files = Object.values(entry!.outputs ?? {}).flatMap((o) => Object.values(o).flat())
    const vid = files.find((f) => f?.filename && /[.](mp4|webm|mkv)$/i.test(f.filename))
    expect(vid, `[h3] no video in outputs: ${JSON.stringify(files)}`).toBeTruthy()
    const mp4 = path.join(outputDir, vid!.subfolder ?? '', vid!.filename!)
    expect(fs.existsSync(mp4), `[h3] missing on disk: ${mp4}`).toBe(true)
    if (COLLECT) fs.copyFileSync(mp4, path.join(COLLECT, 'h3-from-sheet.mp4'))

    const gray = (t: number): Buffer =>
      execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', mp4, '-frames:v', '1',
        '-vf', 'scale=64:64', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
        { maxBuffer: 32 * 1024 * 1024 }) as unknown as Buffer
    const mean = (b: Buffer) => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i]; return s / b.length }

    const first = gray(0.2)
    const mid = gray(2.0)
    let motion = 0
    for (let i = 0; i < first.length; i++) motion += Math.abs(first[i] - mid[i])
    motion /= first.length
    console.log(`  [h3] ${vid!.filename} in ${secs}s  luma=${mean(first).toFixed(1)}  motion=${motion.toFixed(1)}`)

    // A black clip and a frozen still would both report success otherwise.
    expect(mean(first), '[h3] first frame is not black').toBeGreaterThan(12)
    expect(motion, '[h3] the clip actually moves').toBeGreaterThan(2)
  }, RENDER_TIMEOUT_MS)

})
