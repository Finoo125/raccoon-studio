/**
 * H3 Edit mode (video-to-video) through the real builder — live regression.
 *
 *   cd app
 *   H3_V2V_DIR=<scratch dir> LIVE_RENDER=1 \
 *     node_modules/.bin/vitest run src/lib/workflows/h3-v2v.live.test.ts
 *
 * Two of the clips the 2026-10-02 spike edited (owner folder
 * `261002 - H3 Video2Video Test`): the café clip with a VFX edit and the gym
 * clip restyled. Each result has to differ from its source — mean |grey diff|
 * of a 64×64 mid-clip frame above 3 (the no-LoRA control measured as the
 * source) — and still be the same take: the frames' EDGE maps correlate above
 * 0.15. Not a tone bound: a charcoal restyle changes every pixel's tone (diff
 * 69) while keeping every edge. Calibrated 2026-10-02: café edit r 0.82, gym
 * charcoal 0.31, unrelated clips 0.01-0.02.

 *
 * Plus a 12 s clip (`h3-edit-12s.mp4` in ComfyUI's input dir — the first 12 s
 * of the 2026-10-03 spike's synthetic park clip) edited at the medium size,
 * where it must split into parts: Seamless and Fast, each checked at 2, 6 and
 * 11 s for a visible edit (diff > 3) on the same take (edge r > 0.3). The
 * unsplit v1 graph scored edge r ~0.1 and no edit there.
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { minimaxH3Workflow, H3_EDIT, h3EditPlan, type H3EditKind } from './minimax-h3'
import { arcface, frameAt, liveEnv, renderGraph, rgb, structure } from './live-render'
import { probeMedia } from '@/lib/movies/ffprobe'
import { framesFromDuration } from '@/lib/video/edit-source'
import { buildDescribePicturePrompt, cleanDescription, describeQuestion } from '@/lib/video/describe'
import { chatText, listOllamaVisionModels } from '@/lib/director/ollama'
import type { ComfyUIPrompt } from '@/types/comfyui'

const LIVE = process.env.LIVE_RENDER === '1'
const DIR = process.env.H3_V2V_DIR

const PICKS: { name: string; source: string; kind: H3EditKind; prompt: string }[] = [
  {
    name: 'cafe-vfx',
    source: 'video/MinimaxH3/2026-09-06/211906-MinimaxH3__00001_.mp4',
    kind: 'vfx',
    prompt: 'Change her dark blazer into a bright red leather jacket while preserving her identity, pose, motion, hair, framing, lighting and the cafe background.',
  },
  {
    name: 'gym-style',
    source: 'video/MinimaxH3/2026-09-06/212745-MinimaxH3__00001_.mp4',
    kind: 'style',
    prompt: 'Transform this video into a gritty charcoal sketch style with heavy black linework on paper.',
  },
]

/** A 64×64 grey frame at `t` seconds. */
function grey(file: string, t: number): Buffer {
  const tmp = path.join(DIR!, `_frame_${path.basename(file)}.png`)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', file, '-frames:v', '1', tmp])
  const px = rgb(tmp, 64, 64)
  const out = Buffer.alloc(64 * 64)
  for (let i = 0; i < out.length; i++) out[i] = Math.round((px[3 * i] + px[3 * i + 1] + px[3 * i + 2]) / 3)
  return out
}

/** Pearson r of the two frames' gradient magnitudes — survives a restyle, not a different scene. */
function edgeCorrelation(a: Buffer, b: Buffer): number {
  const edges = (g: Buffer) => {
    const out: number[] = []
    for (let y = 0; y < 63; y++) for (let x = 0; x < 63; x++) {
      const i = y * 64 + x
      out.push(Math.abs(g[i + 1] - g[i]) + Math.abs(g[i + 64] - g[i]))
    }
    return out
  }
  const ea = edges(a), eb = edges(b)
  const ma = ea.reduce((s, v) => s + v, 0) / ea.length
  const mb = eb.reduce((s, v) => s + v, 0) / eb.length
  let num = 0, da = 0, db = 0
  for (let i = 0; i < ea.length; i++) {
    num += (ea[i] - ma) * (eb[i] - mb)
    da += (ea[i] - ma) ** 2
    db += (eb[i] - mb) ** 2
  }
  return num / Math.sqrt(da * db)
}

describe.skipIf(!LIVE)('H3 Edit mode — live', () => {
  it(
    'edits each pick through the builder and keeps the take',
    async () => {
      expect(DIR, 'set H3_V2V_DIR').toBeTruthy()
      fs.mkdirSync(DIR!, { recursive: true })
      const { base, outputDir } = liveEnv()
      for (const pick of PICKS) {
        const src = path.join(outputDir, pick.source)
        const probe = await probeMedia(src)
        await fetch(`${base}/free`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unload_models: true, free_memory: true }),
        }).catch(() => {})
        const wf = minimaxH3Workflow.buildPrompt({
          prompt: pick.prompt,
          mode: 'edit',
          videoModel: 'minimax-h3',
          h3Checkpoint: 'eros',
          editSource: `${pick.source} [output]`,
          editKind: pick.kind,
          editSourceWidth: probe.width,
          editSourceHeight: probe.height,
          editSourceFrames: framesFromDuration(probe.durationSec),
          editSourceHasAudio: probe.hasAudio,
          durationSeconds: 5,
          fps: 24,
          seed: 20261002,
          vramMode: 'medium',
          filmGrain: false,
        }) as ComfyUIPrompt
        expect(Object.values(wf).some((n) => n.class_type === 'LoraLoaderModelOnly' && n.inputs.lora_name === H3_EDIT[pick.kind].lora)).toBe(true)
        const r = await renderGraph(base, wf, pick.name, outputDir)
        const mp4 = r.files.find((f) => f.endsWith('.mp4'))
        expect(mp4, `${pick.name}: no mp4`).toBeTruthy()
        fs.copyFileSync(mp4!, path.join(DIR!, `${pick.name}.mp4`))
        const t = probe.durationSec / 2
        const a = grey(src, t)
        const b = grey(mp4!, t)
        let diff = 0
        for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i])
        diff /= a.length
        const r2 = edgeCorrelation(a, b)
        console.log(`[h3-v2v] ${pick.name}: ${r.seconds.toFixed(0)}s, mid-clip diff ${diff.toFixed(1)}, edge r ${r2.toFixed(2)}`)
        expect(diff, `${pick.name}: no visible edit`).toBeGreaterThan(3)
        expect(r2, `${pick.name}: not the same take`).toBeGreaterThan(0.15)
      }
    },
    60 * 60_000,
  )
  it(
    'edits a 12 s clip in parts without noise, Seamless and Fast',
    async () => {
      expect(DIR, 'set H3_V2V_DIR').toBeTruthy()
      fs.mkdirSync(DIR!, { recursive: true })
      const { base, inputDir, outputDir } = liveEnv()
      // A synthetic 12 s park clip (spike 2026-10-03, `h3-edit-12s.mp4` in input/).
      // Before this fix, an edit this long at the medium size came back with no
      // edit for ~7 s and noise after — exactly what the late-frame checks catch.
      const src = path.join(inputDir, 'h3-edit-12s.mp4')
      const probe = await probeMedia(src)
      const prompt = 'Change her black sports bra and grey leggings into a bright red sports bra and bright red leggings, while preserving her identity, hair, body, pose, motion, framing, lighting and the park.'
      for (const join of ['seamless', 'fast'] as const) {
        await fetch(`${base}/free`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unload_models: true, free_memory: true }),
        }).catch(() => {})
        const params = {
          prompt, mode: 'edit', videoModel: 'minimax-h3', h3Checkpoint: 'eros', editSource: 'h3-edit-12s.mp4',
          editKind: 'vfx', editJoin: join, editSourceWidth: probe.width, editSourceHeight: probe.height,
          editSourceFrames: framesFromDuration(probe.durationSec), editSourceHasAudio: probe.hasAudio,
          durationSeconds: 5, fps: 24, seed: 20261003, vramMode: 'medium', filmGrain: false,
        } as const
        const parts = h3EditPlan(params)!.length
        expect(parts, 'a 12 s clip at medium must split').toBeGreaterThan(1)
        const r = await renderGraph(base, minimaxH3Workflow.buildPrompt(params) as ComfyUIPrompt, `long-${join}`, outputDir)
        const mp4 = r.files.find((f) => f.endsWith('.mp4'))!
        fs.copyFileSync(mp4, path.join(DIR!, `long-${join}.mp4`))
        for (const t of [2, 6, 11]) {
          const a = grey(src, t)
          const b = grey(mp4, t)
          let diff = 0
          for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i])
          diff /= a.length
          const r2 = edgeCorrelation(a, b)
          console.log(`[h3-v2v] long-${join} (${parts} parts, ${r.seconds.toFixed(0)}s) t=${t}: diff ${diff.toFixed(1)}, edge r ${r2.toFixed(2)}`)
          expect(r2, `long-${join} t=${t}: not the same take (noise?)`).toBeGreaterThan(0.3)
          expect(diff, `long-${join} t=${t}: no visible edit`).toBeGreaterThan(3)
        }
      }
    },
    90 * 60_000,
  )
  it(
    'gate: 1, 2 and 3 pictures in one edit each still land',
    async () => {
      expect(DIR, 'set H3_V2V_DIR').toBeTruthy()
      fs.mkdirSync(DIR!, { recursive: true })
      const { base, inputDir, outputDir } = liveEnv()
      const src = path.join(inputDir, 'vr-src-studio.mp4')
      const probe = await probeMedia(src)
      const legs: [string, string[], string[]][] = [
        ['one', ['vr-person.png'], ['character']],
        ['two', ['vr-person.png', 'vr-location.png'], ['character', 'location']],
        ['three', ['vr-person.png', 'vr-outfit.png', 'vr-location.png'], ['character', 'outfit', 'location']],
      ]
      /** Share of pixels that are saturated emerald green (the outfit picture). */
      const green = (png: string) => {
        const px = rgb(png, 128)
        let n = 0
        // Calibrated on the gate frames 2026-10-03: the emerald bikini 0.013, no bikini ≤ 0.001.
        for (let i = 0; i < px.length; i += 3) if (px[i + 1] > 40 && px[i + 1] > px[i] * 1.3 && px[i + 1] > px[i + 2] * 1.1) n++
        return n / (px.length / 3)
      }
      /** Mean saturation (max−min) of the top fifth of the frame — white studio ≈ low, a beach sky ≈ high. */
      const topSaturation = (png: string) => {
        const px = rgb(png, 64, 64)
        let s = 0
        const rows = Math.floor(64 / 5)
        for (let i = 0; i < 64 * rows * 3; i += 3) s += Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2])
        return s / (64 * rows)
      }
      const srcFrame = frameAt(src, 4, path.join(DIR!, 'gate-src-4s.png'))
      const report: Record<string, unknown> = { sourceTopSaturation: topSaturation(srcFrame), sourceGreen: green(srcFrame) }
      for (const [name, pictures, roles] of legs) {
        await fetch(`${base}/free`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(() => {})
        const params = {
          prompt: 'Replace the woman with the person from the picture, while preserving the pose, motion and framing.',
          mode: 'edit', videoModel: 'minimax-h3', h3Checkpoint: 'eros', editSource: 'vr-src-studio.mp4', editKind: 'vfx',
          editPictures: pictures, editPictureRoles: roles, editSourceWidth: probe.width, editSourceHeight: probe.height,
          editSourceFrames: framesFromDuration(probe.durationSec), editSourceHasAudio: probe.hasAudio,
          durationSeconds: 5, fps: 24, seed: 20261003, vramMode: 'medium', filmGrain: false,
        } as const
        const r = await renderGraph(base, minimaxH3Workflow.buildPrompt(params) as ComfyUIPrompt, `gate-${name}`, outputDir)
        const mp4 = r.files.find((f) => f.endsWith('.mp4'))!
        const local = path.join(DIR!, `gate-${name}.mp4`)
        fs.copyFileSync(mp4, local)
        const frames = [2, 4, 6].map((t) => frameAt(local, t, path.join(DIR!, `gate-${name}-${t}s.png`)))
        const ids = arcface(path.join(inputDir, 'vr-face.png'), frames)
        report[name] = {
          parts: h3EditPlan(params)!.length, seconds: r.seconds, arcface: ids,
          green: frames.map(green), topSaturation: frames.map(topSaturation),
        }
        fs.writeFileSync(path.join(DIR!, 'gate.json'), JSON.stringify(report, null, 2))
        console.log(`[h3-v2v] gate-${name}`, JSON.stringify(report[name]))
        // Measured 2026-10-03: location and outfit pictures land (beach top saturation
        // 72 / 53 vs the studio's 11; emerald share 0.013 vs ≤0.001), a person's
        // identity does not (ArcFace ~0.03) — the face swap covers that.
        const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
        const sat = mean(frames.map(topSaturation))
        if (roles.includes('location')) expect(sat, `gate-${name}: the location picture should land`).toBeGreaterThan(Number(report.sourceTopSaturation) + 15)
        if (roles.includes('outfit')) expect(mean(frames.map(green)), `gate-${name}: the outfit picture should land`).toBeGreaterThan(0.008)
      }
    },
    90 * 60_000,
  )
  it(
    'person + face swap, Swap head and first frame land on the studio clip',
    async () => {
      expect(DIR, 'set H3_V2V_DIR').toBeTruthy()
      fs.mkdirSync(DIR!, { recursive: true })
      const { base, inputDir, outputDir } = liveEnv()
      const src = path.join(inputDir, 'vr-src-studio.mp4')
      const probe = await probeMedia(src)
      const common = {
        mode: 'edit', videoModel: 'minimax-h3', h3Checkpoint: 'eros', editSource: 'vr-src-studio.mp4',
        editSourceWidth: probe.width, editSourceHeight: probe.height, editSourceFrames: framesFromDuration(probe.durationSec),
        editSourceHasAudio: probe.hasAudio, durationSeconds: 5, fps: 24, seed: 20261003, vramMode: 'medium', filmGrain: false,
      } as const
      const legs = {
        // As the panel tells users: the face comes from the picture, the look from
        // the words. Picture + a generic instruction measured 0.54 (2026-10-03).
        person: { ...common, editKind: 'vfx', prompt: 'Replace the woman with a muscular woman in her fifties with a short silver pixie cut, tanned skin, a black floral sleeve tattoo on her left arm, a red sports bra and black shorts, while preserving the pose, motion and framing.', editPictures: ['vr-person.png'], editPictureRoles: ['character'], editFaceChecked: 'vr-person.png' },
        head: { ...common, editKind: 'head', prompt: 'Female, around fifty, oval face with defined cheekbones, tanned skin, blue-grey eyes, short silver pixie cut, no jewelry or glasses', editPictures: ['vr-face.png'], editPictureRoles: ['character'] },
        first: { ...common, editKind: 'vfx', prompt: 'Change her golden bikini into the emerald-green sequined bikini, while preserving her identity, hair, body, pose, motion, framing and the white background.', editFirstFrame: 'vr-ff-outfit-studio.png' },
        // A clearly different person (review, phase 2): the edited face stays the
        // woman's, a stranger to this man — arcface cosine around and below 0. The
        // swap must still take the main face on EVERY frame (threshold 0 = best face).
        stranger: { ...common, editKind: 'vfx', prompt: 'Replace the woman with the person from the picture, while preserving the pose, motion and framing.', editPictures: ['vr-man.png'], editPictureRoles: ['character'], editFaceChecked: 'vr-man.png' },
      } as const
      const out: Record<string, unknown> = {}
      for (const [name, params] of Object.entries(legs)) {
        await fetch(`${base}/free`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(() => {})
        const r = await renderGraph(base, minimaxH3Workflow.buildPrompt(params as never) as ComfyUIPrompt, `pic-${name}`, outputDir)
        const local = path.join(DIR!, `pic-${name}.mp4`)
        fs.copyFileSync(r.files.find((f) => f.endsWith('.mp4'))!, local)
        const frames = [2, 4, 6].map((t) => frameAt(local, t, path.join(DIR!, `pic-${name}-${t}s.png`)))
        const ids = arcface(path.join(inputDir, name === 'stranger' ? 'vr-man.png' : 'vr-face.png'), frames)
        const mean = ids.reduce<number>((s, v) => s + (v ?? 0), 0) / ids.length
        // The swap node's own report, e.g. "193 frames · slot 1: 193/193".
        const cov = r.texts.join(' ').match(/slot 1: (\d+)\/(\d+)/)
        const coverage = cov ? Number(cov[1]) / Number(cov[2]) : null
        out[name] = { seconds: r.seconds, arcface: ids, mean, swapReport: r.texts, coverage }
        fs.writeFileSync(path.join(DIR!, 'pictures.json'), JSON.stringify(out, null, 2))
        if (name === 'person') expect(mean, 'person + face swap: face should be the picture').toBeGreaterThan(0.6)
        if (name === 'head') expect(mean, 'Swap head: face should be the picture').toBeGreaterThan(0.45)
        if (name === 'person' || name === 'stranger') expect(coverage, `${name}: the swap should cover (nearly) every frame`).toBeGreaterThan(0.9)
        if (name === 'stranger') expect(mean, 'stranger: face should be the man from the picture').toBeGreaterThan(0.5)
        if (name === 'first') {
          // The spike's FFP outfit edit turned ~2% of the frame emerald; the source has none.
          const px = rgb(frames[1], 128)
          let g = 0
          for (let i = 0; i < px.length; i += 3) if (px[i + 1] > 40 && px[i + 1] > px[i] * 1.3 && px[i + 1] > px[i + 2] * 1.1) g++
          expect(g / (px.length / 3), 'first frame: the green bikini should carry through').toBeGreaterThan(0.008)
        }
      }
    },
    90 * 60_000,
  )
  it(
    'described person: a generic instruction changes the whole look, built-in and Ollama',
    async () => {
      expect(DIR, 'set H3_V2V_DIR').toBeTruthy()
      fs.mkdirSync(DIR!, { recursive: true })
      const { base, inputDir, outputDir } = liveEnv()
      const src = path.join(inputDir, 'vr-src-studio.mp4')
      const probe = await probeMedia(src)
      const question = describeQuestion('character', false)
      const out: Record<string, unknown> = {}
      // Without a description this instruction swapped only the face (0.54, the
      // woman's long dark hair stayed) — the edit takes a person's look from words.
      for (const describer of ['builtin', 'ollama:qwen3.5:27b']) {
        let note: string
        if (describer === 'builtin') {
          const d = await renderGraph(base, buildDescribePicturePrompt('vr-person.png', question) as ComfyUIPrompt, 'describe-builtin', outputDir)
          note = cleanDescription(d.texts[0] ?? '')
        } else {
          const model = describer.slice('ollama:'.length)
          if (!(await listOllamaVisionModels()).includes(model)) {
            console.warn(`[h3-v2v] described person: Ollama ${model} not installed — leg skipped`)
            continue
          }
          const b64 = fs.readFileSync(path.join(inputDir, 'vr-person.png')).toString('base64')
          note = cleanDescription(await chatText(model, [{ role: 'user', content: question, images: [b64] }], 300_000))
        }
        expect(note, `${describer}: should describe the person`).toMatch(/silver|grey|gray|white|platinum/i)
        await fetch(`${base}/free`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(() => {})
        const params = {
          mode: 'edit', videoModel: 'minimax-h3', h3Checkpoint: 'eros', editSource: 'vr-src-studio.mp4', editKind: 'vfx',
          prompt: 'Replace the woman with the person from the picture, while preserving the pose, motion and framing.',
          editPictures: ['vr-person.png'], editPictureRoles: ['character'], editPictureNotes: [note], editFaceChecked: 'vr-person.png',
          editSourceWidth: probe.width, editSourceHeight: probe.height, editSourceFrames: framesFromDuration(probe.durationSec),
          editSourceHasAudio: probe.hasAudio, durationSeconds: 5, fps: 24, seed: 20261003, vramMode: 'medium', filmGrain: false,
        } as const
        const label = `described-${describer.replace(/[^a-z0-9]+/gi, '-')}`
        const r = await renderGraph(base, minimaxH3Workflow.buildPrompt(params as never) as ComfyUIPrompt, label, outputDir)
        const local = path.join(DIR!, `${label}.mp4`)
        fs.copyFileSync(r.files.find((f) => f.endsWith('.mp4'))!, local)
        const frames = [2, 4, 6].map((t) => frameAt(local, t, path.join(DIR!, `${label}-${t}s.png`)))
        const ids = arcface(path.join(inputDir, 'vr-face.png'), frames)
        const mean = ids.reduce<number>((acc, v) => acc + (v ?? 0), 0) / ids.length
        const cov = r.texts.join(' ').match(/slot 1: (\d+)\/(\d+)/)
        const coverage = cov ? Number(cov[1]) / Number(cov[2]) : null
        out[describer] = { note, seconds: r.seconds, arcface: ids, mean, coverage }
        fs.writeFileSync(path.join(DIR!, 'described.json'), JSON.stringify(out, null, 2))
        expect(mean, `${describer}: the face should be the picture's`).toBeGreaterThan(0.6)
        expect(coverage, `${describer}: the swap should cover (nearly) every frame`).toBeGreaterThan(0.9)
      }
    },
    90 * 60_000,
  )
  it(
    'Loosely: a new person on the studio clip, and a 15 s clip in parts without noise',
    async () => {
      expect(DIR, 'set H3_V2V_DIR').toBeTruthy()
      fs.mkdirSync(DIR!, { recursive: true })
      const { base, inputDir, outputDir } = liveEnv()
      const legOf = async (file: string) => {
        const probe = await probeMedia(path.join(inputDir, file))
        return {
          mode: 'edit', editFollow: 'loose', videoModel: 'minimax-h3', h3Checkpoint: 'eros', editSource: file,
          editSourceWidth: probe.width, editSourceHeight: probe.height, editSourceFrames: framesFromDuration(probe.durationSec),
          editSourceHasAudio: probe.hasAudio, durationSeconds: 5, fps: 24, seed: 20261003, vramMode: 'medium', filmGrain: false,
        } as const
      }
      const free = () => fetch(`${base}/free`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(() => {})
      const out: Record<string, unknown> = {}

      // 1. A new person, no face swap: the loose route alone.
      await free()
      // The note as the built-in describer writes it (phase 2b).
      const d = await renderGraph(base, buildDescribePicturePrompt('vr-person.png', describeQuestion('character', false)) as ComfyUIPrompt, 'loose-describe', outputDir)
      const note = cleanDescription(d.texts[0] ?? '')
      expect(note, 'the built-in describer should describe the person').toMatch(/silver|grey|gray|white|platinum/i)
      const person = { ...(await legOf('vr-src-studio.mp4')), prompt: 'Replace the woman with the person from the picture.', editPictures: ['vr-person.png'], editPictureRoles: ['character'], editPictureNotes: [note], editSwapFace: false }
      const r1 = await renderGraph(base, minimaxH3Workflow.buildPrompt(person as never) as ComfyUIPrompt, 'loose-person', outputDir)
      const p1 = path.join(DIR!, 'loose-person.mp4')
      fs.copyFileSync(r1.files.find((f) => f.endsWith('.mp4'))!, p1)
      // Frame 0 too: without a description the native route opened on the reference picture itself.
      const f1 = [0.05, 2, 4, 6].map((t) => frameAt(p1, t, path.join(DIR!, `loose-person-${t}s.png`)))
      const ids = arcface(path.join(inputDir, 'vr-face.png'), f1)
      const mean = ids.reduce<number>((s, v) => s + (v ?? 0), 0) / ids.length
      out.person = { seconds: r1.seconds, arcface: ids, mean }
      // Spike: 0.44 on this clip at half size, against 0.22-0.31 for the anchored routes without a swap.
      expect(mean, 'loose person: the face should move toward the picture').toBeGreaterThan(0.3)
      // Every sampled frame, frame 0 included: undescribed, the native route opened on the
      // reference picture and then went back to the original woman.
      for (const [k, v] of ids.entries()) expect(v ?? 0, `loose person: frame ${k} is not the new person`).toBeGreaterThan(0.25)

      // 2. 15 s in parts: every sampled frame is a picture, not noise.
      await free()
      const long = { ...(await legOf('h3-edit-15s.mp4')), prompt: 'Change her black sports bra and grey leggings into a bright red sports bra and bright red leggings.' }
      const parts = h3EditPlan(long)!.length
      expect(parts, '15 s at medium must split even loosely').toBeGreaterThan(1)
      const r2 = await renderGraph(base, minimaxH3Workflow.buildPrompt(long as never) as ComfyUIPrompt, 'loose-15s', outputDir)
      const p2 = path.join(DIR!, 'loose-15s.mp4')
      fs.copyFileSync(r2.files.find((f) => f.endsWith('.mp4'))!, p2)
      const structures = [2, 7, 13].map((t) => structure(frameAt(p2, t, path.join(DIR!, `loose-15s-${t}s.png`))))
      out.long = { seconds: r2.seconds, parts, structures }
      fs.writeFileSync(path.join(DIR!, 'loose.json'), JSON.stringify(out, null, 2))
      // Clean frames measured 26-57 on this scale, noise/texture 0-16.
      for (const s of structures) expect(s, 'loose 15 s: a frame came back as noise').toBeGreaterThan(20)
    },
    90 * 60_000,
  )
  it(
    'Person + Outfit: the face from one picture, the clothes from the other, Loosely and Exactly',
    async () => {
      expect(DIR, 'set H3_V2V_DIR').toBeTruthy()
      fs.mkdirSync(DIR!, { recursive: true })
      const { base, inputDir, outputDir } = liveEnv()
      const src = path.join(inputDir, 'vr-src-studio.mp4')
      const probe = await probeMedia(src)
      const free = () => fetch(`${base}/free`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(() => {})
      // The person picture wears a red sports bra; its description says so. With an
      // outfit picture beside it, that must not win over the emerald bikini.
      const describe = async (file: string, role: string) => {
        const d = await renderGraph(base, buildDescribePicturePrompt(file, describeQuestion(role, false)) as ComfyUIPrompt, `po-describe-${role}`, outputDir)
        return cleanDescription(d.texts[0] ?? '')
      }
      const notes = [await describe('vr-person.png', 'character'), await describe('vr-outfit.png', 'outfit')]
      expect(notes[0], 'the person should be described').toMatch(/silver|grey|gray|white|platinum/i)
      expect(notes[1], 'the outfit should be described').toMatch(/green|emerald/i)
      const common = {
        mode: 'edit', videoModel: 'minimax-h3', h3Checkpoint: 'eros', editSource: 'vr-src-studio.mp4', editKind: 'vfx',
        prompt: 'Replace the woman with the person from the picture.',
        editPictures: ['vr-person.png', 'vr-outfit.png'], editPictureRoles: ['character', 'outfit'], editPictureNotes: notes,
        editSourceWidth: probe.width, editSourceHeight: probe.height, editSourceFrames: framesFromDuration(probe.durationSec),
        editSourceHasAudio: probe.hasAudio, durationSeconds: 5, fps: 24, seed: 20261003, vramMode: 'medium', filmGrain: false,
      } as const
      const legs = {
        loose: { ...common, editFollow: 'loose', editSwapFace: false },
        exact: { ...common, editFollow: 'exact', editFaceChecked: 'vr-person.png' },
      } as const
      /** Share of saturated emerald pixels — gate calibration: bikini 0.013, none ≤ 0.001. */
      const green = (png: string) => {
        const px = rgb(png, 128)
        let n = 0
        for (let i = 0; i < px.length; i += 3) if (px[i + 1] > 40 && px[i + 1] > px[i] * 1.3 && px[i + 1] > px[i + 2] * 1.1) n++
        return n / (px.length / 3)
      }
      const out: Record<string, unknown> = { notes }
      for (const [name, params] of Object.entries(legs)) {
        await free()
        const r = await renderGraph(base, minimaxH3Workflow.buildPrompt(params as never) as ComfyUIPrompt, `po-${name}`, outputDir)
        const local = path.join(DIR!, `po-${name}.mp4`)
        fs.copyFileSync(r.files.find((f) => f.endsWith('.mp4'))!, local)
        const frames = [2, 4, 6].map((t) => frameAt(local, t, path.join(DIR!, `po-${name}-${t}s.png`)))
        const ids = arcface(path.join(inputDir, 'vr-face.png'), frames)
        const mean = ids.reduce<number>((s, v) => s + (v ?? 0), 0) / ids.length
        const greens = frames.map(green)
        out[name] = { seconds: r.seconds, arcface: ids, mean, green: greens }
        fs.writeFileSync(path.join(DIR!, 'person-outfit.json'), JSON.stringify(out, null, 2))
        console.log(`[h3-v2v] po-${name}`, JSON.stringify(out[name]))
        // Loosely without a swap measured 0.538 for the person alone; Exactly with the swap 0.65.
        expect(mean, `${name}: the face should be the person's`).toBeGreaterThan(name === 'exact' ? 0.6 : 0.3)
        expect(greens.reduce((a, b) => a + b, 0) / greens.length, `${name}: the outfit picture's bikini should be worn`).toBeGreaterThan(0.008)
      }
    },
    60 * 60_000,
  )
})
