/**
 * SPIKE (2026-10-02, feature list item 8): a longer reference video that passes
 * through ANCHOR pictures. Each link continues the previous one (masked prefix)
 * and is pinned to land on the next anchor — core `MiniMaxH3AddGuide` on the
 * last frame, which works on reference-mode conditioning too (the reference
 * node itself has no last-frame input). Arm `free` is the same chain without
 * the anchors, so the comparison shows what they add.
 *
 *   cd app
 *   ANCHOR_DIR=<dir> ANCHOR_PHASE=anchors LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/h3-anchor-chain.live.test.ts
 *   ANCHOR_DIR=<dir> ANCHOR_PHASE=chain   LIVE_RENDER=1 node_modules/.bin/vitest run src/lib/workflows/h3-anchor-chain.live.test.ts
 *
 * Phase `anchors` makes the three pictures with the Qwen-Image 2.1 Edit preset
 * from one character picture; anchors 2 and 3 are edits OF anchor 1, changing
 * only the pose, so the gym stays the same room.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { workflows } from './index'
import { minimaxH3Workflow, H3_CONTEXT_FRAMES, H3_FPS } from './minimax-h3'
import { liveEnv, renderGraph, structure } from './live-render'
import type { GenerationParams } from '@/types/workflow'
import type { ComfyUIPrompt, ComfyUIPromptNode } from '@/types/comfyui'

const LIVE = process.env.LIVE_RENDER === '1'
const DIR = process.env.ANCHOR_DIR
const PHASE = process.env.ANCHOR_PHASE ?? 'chain'
const CHARACTER = process.env.ANCHOR_CHARACTER ?? '105619-KREA2__00001_.png'
const SEED = 20261003

const KEEP = 'keep her face, hair, muscular physique and bikini exactly as they are; full body in frame'
const ANCHOR_EDITS = [
  { from: 'character', prompt: `put the woman from picture 1 in a bright modern gym with wall mirrors and dumbbell racks, standing and facing the camera, holding a heavy dumbbell in each hand at her sides; ${KEEP}` },
  { from: 'anchor-1', prompt: `change only her pose: she curls the dumbbell in her right hand up to her shoulder in a bicep curl, the left arm relaxed; keep the gym, the light and the camera angle; ${KEEP}` },
  { from: 'anchor-1', prompt: `change only her pose: she has put the dumbbells down and hits a front double biceps pose, both arms raised and flexed, facing the camera; keep the gym, the light and the camera angle; ${KEEP}` },
]

const head = 'For the target video, the attached references are used as follows: <Picture 1> is fully_preserved.\n\n'
const tail = (music: string) =>
  '\n\noverall_soundscape: Gym ambience with a low ventilation hum, dumbbells clinking on the rack, bare feet on rubber flooring and her steady breathing.' +
  `\n\nnon_diegetic_music: ${music}`
const LINKS = [
  head + 'integrated_multimodal_description: [Shot 1] Cinematic live-action, a bright modern gym with wall mirrors and racks of dumbbells. The person from <Picture 1> walks in from the left, takes a heavy dumbbell in each hand from the rack and turns to face the camera, standing tall with the dumbbells at her sides. The camera tracks with her at medium distance and settles in front of her.' + tail('A steady electronic beat at a moderate tempo.'),
  head + 'integrated_multimodal_description: [Shot 1] Cinematic live-action, the same bright gym. The person from <Picture 1> sets the left dumbbell down on the rack beside her, then curls the right dumbbell slowly up to her shoulder in a controlled bicep curl and holds it there, the muscles of her arm tensed, the left arm relaxed at her side. The camera holds steady in front of her.' + tail('The same steady electronic beat continues.'),
  head + 'integrated_multimodal_description: [Shot 1] Cinematic live-action, the same bright gym. The person from <Picture 1> lowers the dumbbell, sets it down on the rack, straightens up and hits a front double biceps pose facing the camera, flexing both arms hard. The camera pushes in slightly.' + tail('The beat builds slightly and holds.'),
]

const idOf = (wf: Record<string, ComfyUIPromptNode>, cls: string) => Object.keys(wf).find((k) => wf[k].class_type === cls)!

/** 64×64 grey of a frame or picture, the picture first centre-cropped to `aspect` (what AddGuide does). */
function grey(file: string, opts: { aspect?: number; last?: boolean } = {}): Buffer {
  const crop = opts.aspect ? `crop='min(iw,ih*${opts.aspect})':'min(ih,iw/${opts.aspect})',` : ''
  const args = ['-v', 'error', ...(opts.last ? ['-sseof', '-0.1'] : []), '-i', file, '-frames:v', '1',
    '-vf', `${crop}scale=64:64`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']
  return execFileSync('ffmpeg', args, { maxBuffer: 1 << 20 }) as unknown as Buffer
}
const meanDiff = (a: Buffer, b: Buffer) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length

describe.skipIf(!LIVE)('H3 anchor chain spike', () => {
  it(`phase ${PHASE}`, async () => {
    expect(DIR, 'set ANCHOR_DIR').toBeTruthy()
    fs.mkdirSync(DIR!, { recursive: true })
    const { base, outputDir, inputDir } = liveEnv()
    const free = () => fetch(`${base}/free`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    }).catch(() => {})

    if (PHASE === 'anchors') {
      const edit = workflows.find((w) => w.id === 'qwen21-edit')!
      const names: Record<string, string> = { character: CHARACTER }
      for (const [i, a] of ANCHOR_EDITS.entries()) {
        await free()
        const params = { prompt: a.prompt, qwenReferences: [names[a.from]], seed: SEED + i, width: 832, height: 1216, upscale: false, detailer: false } as unknown as GenerationParams
        const { files, seconds } = await renderGraph(base, edit.buildPrompt(params), `anchor-${i + 1}`, outputDir)
        const name = `anchor-chain-${i + 1}.png`
        fs.copyFileSync(files[0], path.join(inputDir, name))
        fs.copyFileSync(files[0], path.join(DIR!, name))
        names[`anchor-${i + 1}`] = name
        expect(structure(files[0]), `anchor ${i + 1} is grey texture`).toBeGreaterThan(20)
        console.log(`[anchor] ${name} ${seconds.toFixed(0)}s`)
      }
      return
    }

    if (PHASE === 'single') {
      // ONE 15 s render through all three anchors: start, middle, end.
      const prompt = head + 'integrated_multimodal_description: [Shot 1] Cinematic live-action, a bright modern gym with wall mirrors and racks of dumbbells, one continuous shot, the camera holding steady in front of her at full-body distance. The person from <Picture 1> stands facing the camera with a heavy dumbbell in each hand at her sides. She sets the left dumbbell down on the rack beside her and curls the right dumbbell slowly up to her shoulder in a controlled bicep curl, holding it there with the muscles of her arm tensed. Then she lowers the dumbbell, sets it down on the rack, straightens up and hits a front double biceps pose facing the camera, flexing both arms hard.' + tail('A steady electronic beat at a moderate tempo.')
      const at = [0, 181, -1]
      const out: Record<string, { file: string; seconds: number; landing: number[] }> = {}
      for (const arm of ['anchored', 'free'] as const) {
        await free()
        const wf = minimaxH3Workflow.buildPrompt({
          prompt, mode: 'ref2v', videoModel: 'minimax-h3', h3Checkpoint: 'eros',
          refImages: [CHARACTER], refImageRoles: ['character'], ref2vTurbo: true,
          orientation: 'portrait', durationSeconds: 15, fps: 24, seed: SEED + 100,
          vramMode: 'medium', filmGrain: false, rife: false, upscale: false, sharpen: false,
        }) as unknown as Record<string, ComfyUIPromptNode>
        if (arm === 'anchored') {
          const guider = wf[idOf(wf, 'BasicGuider')]
          const cond = idOf(wf, 'MiniMaxH3ReferenceToVideo')
          const vae = wf[idOf(wf, 'VAEDecode')].inputs.vae
          let n = Object.keys(wf).length + 200
          for (const [k, frame] of at.entries()) {
            wf[n] = { class_type: 'LoadImage', _meta: { title: `Anchor ${k + 1}` }, inputs: { image: `anchor-chain-${k + 1}.png` } }
            wf[n + 1] = {
              class_type: 'MiniMaxH3AddGuide',
              _meta: { title: `Anchor ${k + 1} at frame ${frame}` },
              inputs: { positive: guider.inputs.conditioning, latent: [cond, 1], vae, image: [String(n), 0], frame_idx: frame },
            }
            guider.inputs.conditioning = [String(n + 1), 0]
            n += 2
          }
        }
        const r = await renderGraph(base, wf as unknown as ComfyUIPrompt, `single ${arm}`, outputDir)
        const mp4 = r.files.find((f) => f.endsWith('.mp4'))!
        expect(mp4, `single ${arm}: no mp4`).toBeTruthy()
        const local = path.join(DIR!, `single-${arm}.mp4`)
        fs.copyFileSync(mp4, local)
        const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', local]).toString().trim().split(',').map(Number)
        const frameAt = (i: number) => execFileSync('ffmpeg', ['-v', 'error', '-i', local, '-vf', `select=eq(n\\,${i}),scale=64:64`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 20 }) as unknown as Buffer
        const total = Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', local]).toString().trim())
        const landing = at.map((f, k) => meanDiff(frameAt(f < 0 ? total + f : f), grey(path.join(DIR!, `anchor-chain-${k + 1}.png`), { aspect: dims[0] / dims[1] })))
        out[arm] = { file: local, seconds: r.seconds, landing }
        console.log(`[single] ${arm}: ${r.seconds.toFixed(0)}s, ${total} frames, vs anchors ${landing.map((x) => x.toFixed(1)).join(' / ')}`)
        fs.writeFileSync(path.join(DIR!, 'single.json'), JSON.stringify({ at, total, out }, null, 2))
      }
      return
    }

    const results: Record<string, { links: string[]; landing: number[]; seconds: number[] }> = {}
    for (const arm of ['anchored', 'free'] as const) {
      let prev: string | undefined
      const links: string[] = [], landing: number[] = [], seconds: number[] = []
      for (const [k, prompt] of LINKS.entries()) {
        await free()
        const wf = minimaxH3Workflow.buildPrompt({
          prompt, mode: 'ref2v', videoModel: 'minimax-h3', h3Checkpoint: 'eros',
          refImages: [CHARACTER], refImageRoles: ['character'], ref2vTurbo: true,
          orientation: 'portrait', durationSeconds: 10, fps: 24, seed: SEED + 10 * k,
          vramMode: 'medium', filmGrain: false, rife: false, upscale: false, sharpen: false,
          ...(prev ? { continueFrom: prev } : {}),
        }) as unknown as Record<string, ComfyUIPromptNode>
        if (arm === 'anchored') {
          const n = Object.keys(wf).length + 200
          wf[n] = { class_type: 'LoadImage', _meta: { title: `Anchor ${k + 1}` }, inputs: { image: `anchor-chain-${k + 1}.png` } }
          const guider = wf[idOf(wf, 'BasicGuider')]
          wf[n + 1] = {
            class_type: 'MiniMaxH3AddGuide',
            _meta: { title: `Land on anchor ${k + 1}` },
            inputs: {
              positive: guider.inputs.conditioning,
              latent: [idOf(wf, 'MiniMaxH3ReferenceToVideo'), 1],
              vae: wf[idOf(wf, 'VAEDecode')].inputs.vae,
              image: [String(n), 0],
              frame_idx: -1,
            },
          }
          guider.inputs.conditioning = [String(n + 1), 0]
        }
        const r = await renderGraph(base, wf as unknown as ComfyUIPrompt, `${arm} link ${k + 1}`, outputDir)
        const mp4 = r.files.find((f) => f.endsWith('.mp4'))!
        expect(mp4, `${arm} link ${k + 1}: no mp4`).toBeTruthy()
        const local = path.join(DIR!, `${arm}-${k + 1}.mp4`)
        fs.copyFileSync(mp4, local)
        links.push(local)
        seconds.push(r.seconds)
        const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', local]).toString().trim().split(',').map(Number)
        landing.push(meanDiff(grey(local, { last: true }), grey(path.join(DIR!, `anchor-chain-${k + 1}.png`), { aspect: dims[0] / dims[1] })))
        prev = path.relative(outputDir, mp4).replace(/\\/g, '/')
        console.log(`[chain] ${arm} ${k + 1}: ${r.seconds.toFixed(0)}s, last frame vs anchor ${landing.at(-1)!.toFixed(1)}`)
      }
      // Join the delivered links, as Gallery → Join clips would.
      const joined = path.join(DIR!, `${arm}-joined.mp4`)
      execFileSync('ffmpeg', ['-v', 'error', '-y', ...links.flatMap((l) => ['-i', l]), '-filter_complex',
        links.map((_, i) => `[${i}:v][${i}:a]`).join('') + `concat=n=${links.length}:v=1:a=1[v][a]`,
        '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', joined])
      results[arm] = { links, landing, seconds }
      fs.writeFileSync(path.join(DIR!, 'results.json'), JSON.stringify({ pinned: H3_CONTEXT_FRAMES, fps: H3_FPS, results }, null, 2))
    }
  }, 4 * 60 * 60_000)
})
