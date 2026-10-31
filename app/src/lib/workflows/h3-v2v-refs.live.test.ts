/**
 * SPIKE (throwaway, untracked) — H3 video edit with a reference picture, and
 * splitting long clips. Owner folder `261003 - H3 Video Edit Referenzen`.
 *
 *   cd app
 *   VR_DIR=<dir> VR_PHASE=<phase> LIVE_RENDER=1 \
 *     node_modules/.bin/vitest run src/lib/workflows/h3-v2v-refs.live.test.ts --silent=false
 *
 * Phases, in order: sources, pictures, frames, whole, head, outfit, split.
 * Every source and every picture is synthetic (t2v / Krea2, no face swap).
 * State (file names) lives in <VR_DIR>/state.json, results in results.json.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { minimaxH3Workflow, h3EditFrames } from './minimax-h3'
import { workflows } from './index'
import { buildDetectFacesPrompt, buildVideoFaceSwapPrompt } from './video-face-swap'
import { liveEnv, renderGraph, structure } from './live-render'
import { probeMedia } from '@/lib/movies/ffprobe'
import { framesFromDuration } from '@/lib/video/edit-source'
import type { ComfyUIPrompt, ComfyUIPromptNode } from '@/types/comfyui'
import type { GenerationParams } from '@/types/workflow'
import type { VideoGenerationParams } from '@/types/video-workflow'

const LIVE = process.env.LIVE_RENDER === '1'
const DIR = process.env.VR_DIR ?? ''
const PHASE = process.env.VR_PHASE ?? ''
const SEED = 20261003
const FFP = 'minimax_h3_vfx_edit_v1.0_r128_ffp.safetensors'
const STD = 'minimax_h3_vfx_edit_v1.0_r128.safetensors'
const HEAD = 'minimax_h3_head_swap_v1.0_r32.safetensors'

type Wf = Record<string, ComfyUIPromptNode>
const idOf = (wf: Wf, cls: string) => Object.keys(wf).find((k) => wf[k].class_type === cls)!
const statePath = () => path.join(DIR, 'state.json')
const state = (): Record<string, string> => (fs.existsSync(statePath()) ? JSON.parse(fs.readFileSync(statePath(), 'utf8')) : {})
const remember = (k: string, v: string) => fs.writeFileSync(statePath(), JSON.stringify({ ...state(), [k]: v }, null, 2))
const resultsPath = () => path.join(DIR, 'results.json')
const record = (k: string, v: unknown) => {
  const r = fs.existsSync(resultsPath()) ? JSON.parse(fs.readFileSync(resultsPath(), 'utf8')) : {}
  fs.writeFileSync(resultsPath(), JSON.stringify({ ...r, [k]: v }, null, 2))
}
const ff = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args])

const common: Partial<VideoGenerationParams> = {
  videoModel: 'minimax-h3', h3Checkpoint: 'eros', fps: 24, vramMode: 'medium',
  filmGrain: false, rife: false, upscale: false, sharpen: false, realismLora: false,
}

// ── Prompts ─────────────────────────────────────────────────────────────────

const GYM_T2V =
  'integrated_multimodal_description: [Shot 1] At 00:00.000 Cinematic live-action, a bright modern gym with wall mirrors and racks of dumbbells, one continuous shot, the camera holding steady at full-body distance. A muscular female bodybuilder with a long dark-brown ponytail, olive skin, broad shoulders, a carved six-pack and big arms, wearing a white sports bra and navy-blue leggings, walks toward the camera from the back of the gym, stops in the middle of the frame, rolls her shoulders, and hits a front double biceps pose, flexing both arms hard while she smiles at the camera. She then turns sideways and holds a side chest pose.\n' +
  'overall_soundscape: gym ambience, distant clanking plates, her footsteps on the rubber floor, a short exhale as she flexes.\n' +
  'non_diegetic_music: N/A'

const LONG_A =
  'integrated_multimodal_description: [Shot 1] At 00:00.000 Cinematic live-action, a sunny city park with a wide gravel path, green lawns and tall trees, one continuous shot, the camera tracking backward in front of her at full-body distance. A muscular woman with a long blonde braid, fair skin, defined shoulders and abs, wearing a black sports bra and grey leggings, jogs slowly toward the camera along the path, her braid swinging, then slows to a walk, shakes out her arms and starts shadow-boxing, throwing quick jabs and hooks toward the camera.\n' +
  'overall_soundscape: birdsong, wind in the trees, her footsteps crunching on gravel, steady breathing.\n' +
  'non_diegetic_music: N/A'

const LONG_B =
  'integrated_multimodal_description: [Shot 1] At 00:00.000 Cinematic live-action, the same sunny park path, one continuous shot, the camera holding steady at full-body distance. The same blonde woman in the black sports bra and grey leggings keeps shadow-boxing, then stops, puts her hands on her hips to catch her breath, steps onto the lawn and does a slow deep squat and three walking lunges toward the camera, then stands tall and stretches both arms overhead.\n' +
  'overall_soundscape: birdsong, wind in the trees, her breathing, grass rustling under her shoes.\n' +
  'non_diegetic_music: N/A'

/** MiniMax's full-reference format (VIDEO_PROMPT_WRITING_GUIDE_ref_en.md) for an edit
 *  whose source rides the native reference-video channel. */
function nativePrompt(what: { subject: string; transfer: string; keep: string; body: string }): string {
  return [
    'subject_definitions:',
    what.subject,
    '<Video 1> is the source video for the target video edit, providing the original motion, camera movement, framing, timing and temporal structure.',
    '',
    'summary:',
    `[video editing + reference generation] The target video is an edited version of <Video 1>. ${what.transfer}`,
    '',
    'retention_analysis:',
    `<Subject 1> (appears throughout the target video): attribute_transfer - ${what.keep}`,
    '<Video 1> (entire target timeline): partially_preserved - the original timing, motion, pose, camera movement and framing are preserved.',
    '',
    'detailed_description:',
    what.body,
    '',
    'overall_soundscape: the original ambience and sounds of <Video 1> continue unchanged.',
    '',
    'non_diegetic_music: N/A',
  ].join('\n')
}

const PERSON_DESC =
  'a muscular woman in her fifties with a short silver pixie cut, tanned skin, a black floral sleeve tattoo on her left arm, wearing a red sports bra and black shorts'

// ── Helpers ─────────────────────────────────────────────────────────────────

async function free(base: string) {
  await fetch(`${base}/free`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  }).catch(() => {})
}

async function editParams(source: string, inputDir: string, prompt: string, opts: { skip?: number; frames?: number } = {}) {
  const probe = await probeMedia(path.join(inputDir, source))
  const all = framesFromDuration(probe.durationSec)
  return {
    probe,
    params: {
      ...common, prompt, mode: 'edit', editKind: 'vfx', seed: SEED,
      editSource: source,
      editSourceWidth: probe.width, editSourceHeight: probe.height,
      editSourceFrames: opts.frames ?? all - (opts.skip ?? 0),
      editSourceHasAudio: probe.hasAudio,
      durationSeconds: 5,
    } as VideoGenerationParams,
  }
}

/** Swap the edit LoRA, the trigger, and optionally add <Picture 1> to the edit graph. */
function patchEdit(wf: Wf, o: { lora?: string; prompt?: string; picture?: string; skip?: number }) {
  if (o.lora) {
    const l = Object.values(wf).find((n) => n.class_type === 'LoraLoaderModelOnly' && n.inputs.lora_name === STD)!
    l.inputs.lora_name = o.lora
  }
  const cond = wf[idOf(wf, 'MiniMaxH3ReferenceToVideo')]
  if (o.prompt) cond.inputs.prompt = o.prompt
  if (o.picture) {
    wf['vr:pic'] = { class_type: 'LoadImage', _meta: { title: '<Picture 1>' }, inputs: { image: o.picture } }
    cond.inputs['ref_images.ref_image_0'] = ['vr:pic', 0]
  }
  if (o.skip) wf[idOf(wf, 'VHS_LoadVideo')].inputs.skip_first_frames = o.skip
  return wf
}

async function run(base: string, outputDir: string, wf: Wf, label: string): Promise<{ file: string; seconds: number }> {
  await free(base)
  const r = await renderGraph(base, wf as unknown as ComfyUIPrompt, label, outputDir)
  const src = r.files.find((f) => f.endsWith('.mp4')) ?? r.files.find((f) => f.endsWith('.png'))
  expect(src, `${label}: no output`).toBeTruthy()
  const file = path.join(DIR, `${label}${path.extname(src!)}`)
  fs.copyFileSync(src!, file)
  console.log(`[vr] ${label}: ${r.seconds.toFixed(0)}s -> ${file}`)
  record(`time:${label}`, r.seconds)
  return { file, seconds: r.seconds }
}

/** Re-encode to 24 fps into input/ so every graph reads the same frames. */
function toInput(file: string, inputDir: string, name: string) {
  ff(['-i', file, '-r', '24', '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', path.join(inputDir, name)])
  return name
}

function frameOut(video: string, out: string, opts: { last?: boolean } = {}) {
  ff([...(opts.last ? ['-sseof', '-0.05'] : []), '-i', video, '-frames:v', '1', out])
  return out
}

// ── Phases ──────────────────────────────────────────────────────────────────

describe.skipIf(!LIVE)('H3 video edit with references — spike', () => {
  it(`phase ${PHASE}`, async () => {
    expect(DIR, 'set VR_DIR').toBeTruthy()
    fs.mkdirSync(DIR, { recursive: true })
    const { base, outputDir, inputDir } = liveEnv()
    const s = state()
    const build = (p: VideoGenerationParams) => minimaxH3Workflow.buildPrompt(p) as unknown as Wf

    if (PHASE === 'sources') {
      // studio: the owner's own pure t2v render (#117, 2026-09-07), 36 fps RIFE → 24.
      remember('studio', toInput(path.join(outputDir, 'video/MinimaxH3/2026-09-07/211227-MinimaxH3__00001_.mp4'), inputDir, 'vr-src-studio.mp4'))
      const gym = await run(base, outputDir, build({ ...common, prompt: GYM_T2V, mode: 't2v', orientation: 'portrait', durationSeconds: 8, seed: SEED } as VideoGenerationParams), 'src-gym')
      remember('gym', toInput(gym.file, inputDir, 'vr-src-gym.mp4'))
      const a = await run(base, outputDir, build({ ...common, prompt: LONG_A, mode: 't2v', orientation: 'portrait', durationSeconds: 10, seed: SEED + 1 } as VideoGenerationParams), 'src-long-a')
      // Continue reads ` [output]` paths: hand it the copy sitting in output/.
      const rel = 'vr-long-a.mp4'
      fs.copyFileSync(a.file, path.join(outputDir, rel))
      const b = await run(base, outputDir, build({ ...common, prompt: LONG_B, mode: 't2v', orientation: 'portrait', durationSeconds: 12, seed: SEED + 2, continueFrom: rel } as VideoGenerationParams), 'src-long-b')
      const list = path.join(DIR, '_concat.txt')
      fs.writeFileSync(list, `file '${a.file.replace(/\\/g, '/')}'\nfile '${b.file.replace(/\\/g, '/')}'\n`)
      const long = path.join(DIR, 'src-long.mp4')
      ff(['-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', '-c:a', 'aac', long])
      remember('long', toInput(long, inputDir, 'vr-src-long.mp4'))
      return
    }

    if (PHASE === 'pictures') {
      const krea = workflows.find((w) => w.id === 'krea2-turbo')!
      const pics: [string, string, number, number][] = [
        ['person', `full-body photo of ${PERSON_DESC}, standing relaxed facing the camera, arms at her sides, plain light-grey studio background, soft even light`, 832, 1216],
        ['outfit', 'product photo of an emerald-green sequined two-piece bikini laid flat on a plain white background, top-down, sharp detail', 1024, 1024],
        ['location', 'wide photo of an empty tropical beach at sunset, palm trees, wet golden sand, calm turquoise sea, no people', 1216, 832],
      ]
      for (const [name, prompt, width, height] of pics) {
        await free(base)
        const r = await renderGraph(base, krea.buildPrompt({ prompt, width, height, seed: SEED, upscale: false, detailer: false, promptEnhancer: false } as GenerationParams), name, outputDir)
        const png = r.files.find((f) => f.endsWith('.png'))!
        expect(structure(png), `${name} is empty`).toBeGreaterThan(15)
        fs.copyFileSync(png, path.join(DIR, `pic-${name}.png`))
        fs.copyFileSync(png, path.join(inputDir, `vr-${name}.png`))
        remember(name, `vr-${name}.png`)
      }
      // The same synthetic woman's head, for the head swap: a Qwen edit of the full-body picture.
      const edit = workflows.find((w) => w.id === 'qwen21-edit')!
      await free(base)
      const r = await renderGraph(base, edit.buildPrompt({ prompt: 'A close-up head-and-shoulders portrait photo of the woman in picture 1, the same face, hair and skin, looking straight at the camera, plain light-grey background, soft even light.', qwenReferences: ['vr-person.png'], seed: SEED, width: 1024, height: 1024, upscale: false, detailer: false } as unknown as GenerationParams), 'face', outputDir)
      fs.copyFileSync(r.files[0], path.join(DIR, 'pic-face.png'))
      fs.copyFileSync(r.files[0], path.join(inputDir, 'vr-face.png'))
      remember('face', 'vr-face.png')
      return
    }

    if (PHASE === 'frames') {
      // Each source's first frame, edited by Qwen — the picture FFP propagates.
      const edit = workflows.find((w) => w.id === 'qwen21-edit')!
      const jobs: [string, string, string, string][] = [
        ['ff-person-studio', 'studio', 'person', `Replace the woman in picture 1 with the woman from picture 2: her face, short silver pixie cut, tanned skin, sleeve tattoo, muscular build, red sports bra and black shorts. She takes exactly the place of the woman in picture 1: the same size in the frame, the same crop from the head to the upper thighs, the same position, the same pose with her arms hanging at her sides. Keep the camera framing, lighting and the white background of picture 1.`],
        ['ff-person-gym', 'gym', 'person', `Replace the woman in picture 1 with the woman from picture 2: her face, short silver pixie cut, tanned skin, sleeve tattoo, muscular build, red sports bra and black shorts. Keep the pose, camera framing, lighting and the gym of picture 1.`],
        ['ff-outfit-studio', 'studio', 'outfit', 'Dress the woman in picture 1 in the emerald-green sequined two-piece bikini from picture 2, in place of her golden bikini. Keep her face, hair, body, pose, the camera framing, lighting and background exactly as in picture 1.'],
        ['ff-location-studio', 'studio', 'location', 'Place the woman from picture 1, unchanged, on the tropical beach at sunset from picture 2, in place of the white studio background. She stays exactly the same size and position in the frame as in picture 1, cropped at the same height, with the same pose. Keep her face, hair, body and bikini, with warm sunset light on her.'],
      ]
      for (const [label, src, pic, prompt] of jobs) {
        if (process.env.VR_ONLY && !process.env.VR_ONLY.split(',').includes(label)) continue
        const frame = `vr-frame0-${src}.png`
        frameOut(path.join(inputDir, s[src]), path.join(inputDir, frame))
        await free(base)
        const r = await renderGraph(base, edit.buildPrompt({ prompt, qwenReferences: [frame, s[pic]], seed: SEED, width: 1024, height: 1024, upscale: false, detailer: false } as unknown as GenerationParams), label, outputDir)
        expect(structure(r.files[0]), `${label} is grey texture`).toBeGreaterThan(15)
        fs.copyFileSync(r.files[0], path.join(DIR, `${label}.png`))
        fs.copyFileSync(r.files[0], path.join(inputDir, `vr-${label}.png`))
        remember(label, `vr-${label}.png`)
        record(`time:${label}`, r.seconds)
      }
      return
    }

    const nativeWhole = async (video: string, src: string, extra: Partial<VideoGenerationParams> = {}) => {
      const place = src === 'studio' ? 'the white studio background' : 'the gym'
      const { probe } = await editParams(video, inputDir, '')
      return build({
        ...common, mode: 'ref2v', seed: SEED, orientation: (probe.height ?? 0) > (probe.width ?? 0) ? 'portrait' : 'landscape',
        durationSeconds: Math.min(15, probe.durationSec), refImages: [s.person], refVideos: [video],
        prompt: nativePrompt({
            subject: `<Subject 1> is the woman from <Picture 1>: ${PERSON_DESC}; her face, hair, skin, tattoo, build and outfit come from <Picture 1>, and her motion and pose come from <Video 1>.`,
            transfer: `The woman in <Video 1> is replaced entirely by <Subject 1> from <Picture 1>, who performs exactly the same motion, poses and timing, with the same camera, framing, lighting and ${place}.`,
            keep: `the complete appearance of the woman in <Picture 1> - face, short silver pixie cut, tanned skin, floral sleeve tattoo, muscular build, red sports bra and black shorts - replaces the original woman of <Video 1> for the whole clip.`,
            body: `[Shot 1] At 00:00.000 The target video follows <Video 1> frame by frame: the same camera, framing, lighting and ${place}. In place of the original woman, <Subject 1> from <Picture 1> - ${PERSON_DESC} - performs every movement and pose of the original woman with the same timing. Her face, silver pixie cut, sleeve tattoo, red sports bra and black shorts stay consistent in every frame. Nothing else in <Video 1> changes.`,
          }),
        ...extra,
      } as VideoGenerationParams)
    }

    if (PHASE === 'man') {
      // A clearly different person for the face swap's matching test (review, phase 2).
      const krea = workflows.find((w) => w.id === 'krea2-turbo')!
      await free(base)
      const r = await renderGraph(base, krea.buildPrompt({ prompt: 'close-up head-and-shoulders portrait photo of a man in his forties with short black hair, a short dark beard, brown eyes and a strong jaw, looking straight at the camera, plain light-grey background, soft even light', width: 1024, height: 1024, seed: SEED, upscale: false, detailer: false, promptEnhancer: false } as GenerationParams), 'man', outputDir)
      const png = r.files.find((f) => f.endsWith('.png'))!
      fs.copyFileSync(png, path.join(DIR, 'pic-man.png'))
      fs.copyFileSync(png, path.join(inputDir, 'vr-man.png'))
      return
    }

    if (PHASE === 'nodesc') {
      // Does MiniMax's own reference route use the person picture WITHOUT a text
      // description of her? (The exact route's std LoRA does not — gate leg one.)
      const small = 'vr-src-studio-small.mp4'
      const { probe } = await editParams(small, inputDir, '')
      const prompt = [
        'subject_definitions:',
        '<Subject 1> is the person in <Picture 1>.',
        '<Video 1> is the source video for the target video edit, providing the original motion, camera movement, framing, timing and temporal structure.',
        '',
        'summary:',
        '[video editing + reference generation] The target video is an edited version of <Video 1>. Replace the woman with the person from the picture.',
        '',
        'retention_analysis:',
        '<Subject 1> (appears throughout the target video): attribute_transfer - the person from <Picture 1> is carried into the target video.',
        '<Video 1> (entire target timeline): partially_preserved - the original timing, motion, pose, camera movement and framing are preserved; only what the instruction changes is different.',
        '',
        'detailed_description:',
        '[Shot 1] At 00:00.000 The target video follows <Video 1> frame by frame with the same camera, framing, timing and motion. Replace the woman with the person from the picture. The new person is the one shown in <Picture 1>.',
        '',
        'overall_soundscape: the original ambience and sounds of <Video 1> continue unchanged.',
        '',
        'non_diegetic_music: N/A',
      ].join('\n')
      await run(base, outputDir, build({
        ...common, mode: 'ref2v', seed: SEED, orientation: 'portrait', durationSeconds: Math.min(15, probe.durationSec),
        refImages: [s.person], refVideos: [small], prompt,
      } as VideoGenerationParams), 'nodesc-native-studio')
      return
    }

    if (PHASE === 'attn') {
      // The 9.4 s edit came back noise. One variable: plain PyTorch attention instead of SageAttention.
      const prompt = 'vfx_edit: Change her black sports bra and grey leggings into a bright red sports bra and bright red leggings, while preserving her identity, hair, body, pose, motion, framing, lighting and the park.'
      const n = Number(process.env.VR_FRAMES ?? h3EditFrames(240))
      const ep = (await editParams(s.long, inputDir, prompt, { frames: n })).params
      if (process.env.VR_LOW) {
        // Same length, smaller picture (Sage stays on): does the limit follow the token count?
        await run(base, outputDir, patchEdit(build({ ...ep, vramMode: 'low' }), { prompt }), `attn-low-${n}`)
        return
      }
      const wf = patchEdit(build(ep), { prompt })
      const guider = wf[idOf(wf, 'BasicGuider')]
      wf['vr:attn'] = { class_type: 'ModelAttentionBackend', _meta: { title: 'pytorch attention' }, inputs: { model: guider.inputs.model, attention: 'pytorch attention' } }
      guider.inputs.model = ['vr:attn', 0]
      for (const id of Object.keys(wf)) if (wf[id].class_type === 'BasicScheduler') wf[id].inputs.model = ['vr:attn', 0]
      await run(base, outputDir, wf, `attn-pytorch-${n}`)
      return
    }

    if (PHASE === 'faceswap') {
      // Route C': the picture edit (outfit, hair, tattoo) + the app's own video face swap for the face.
      for (const leg of ['whole-stdpic-studio', 'whole-stdpic-gym']) {
        const rel = `vr-${leg}.mp4`
        fs.copyFileSync(path.join(DIR, `${leg}.mp4`), path.join(outputDir, rel))
        const clip = { file: rel, location: 'output' as const }
        const det = await (await fetch(`${base}/prompt`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: buildDetectFacesPrompt({ clip, position: 0.5, namePrefix: `vr_ref_${leg}` }) }),
        })).json() as { prompt_id: string }
        let found: { filename: string }[] = []
        for (let i = 0; i < 90 && !found.length; i++) {
          await new Promise((r) => setTimeout(r, 2000))
          const h = await (await fetch(`${base}/history/${det.prompt_id}`)).json()
          found = h?.[det.prompt_id]?.outputs?.['det:detect']?.images ?? []
        }
        expect(found.length, `${leg}: no face detected`).toBeGreaterThan(0)
        const wf = buildVideoFaceSwapPrompt({ clip, characters: [{ reference: found[0].filename, sourceImage: s.face }] })
        await run(base, outputDir, wf as unknown as Wf, leg.replace('whole-stdpic', 'whole-stdpic+faceswap'))
      }
      return
    }

    if (PHASE === 'native2') {
      // Why did native break? (a) a half-size reference video, (b) the Hybrid checkpoint.
      const small = 'vr-src-gym-small.mp4'
      ff(['-i', path.join(inputDir, s.gym), '-vf', 'scale=304:528', '-c:v', 'libx264', '-crf', '14', '-c:a', 'copy', path.join(inputDir, small)])
      await run(base, outputDir, await nativeWhole(small, 'gym'), 'native2-small-gym')
      await run(base, outputDir, await nativeWhole(s.gym, 'gym', { h3Checkpoint: 'hybrid' }), 'native2-hybrid-gym')
      return
    }

    if (PHASE === 'whole') {
      for (const src of ['studio', 'gym']) {
        const place = src === 'studio' ? 'the white studio background' : 'the gym'
        // W1 native: the clip in H3's own reference-video channel, the person as <Picture 1>, no LoRA.
        await run(base, outputDir, await nativeWhole(s[src], src), `whole-native-${src}`)

        const ep = (await editParams(s[src], inputDir, 'x')).params
        // W0 control: the standard edit LoRA handed the person picture it was never trained on.
        await run(base, outputDir, patchEdit(build(ep), {
          picture: s.person,
          prompt: `vfx_edit: Replace the woman with the woman from <Picture 1> - ${PERSON_DESC} - while preserving the pose, motion, framing, lighting and ${place}.`,
        }), `whole-stdpic-${src}`)
        // W2 FFP: the edited first frame as <Picture 1>.
        await run(base, outputDir, patchEdit(build(ep), {
          lora: FFP, picture: s[`ff-person-${src}`],
          prompt: `vfx_edit: <Picture 1> is the edited first frame. Replace the woman with the woman shown in <Picture 1> - ${PERSON_DESC} - for the whole clip, while preserving the pose, motion, framing, lighting and ${place}.`,
        }), `whole-ffp-${src}`)
        // W3 two passes: text edit for body and outfit, then the head swap for the face.
        const textEdit = await run(base, outputDir, patchEdit(build(ep), {
          prompt: `vfx_edit: Replace the woman with ${PERSON_DESC}, while preserving the pose, motion, framing, lighting and ${place}.`,
        }), `whole-text-${src}`)
        const passName = toInput(textEdit.file, inputDir, `vr-whole-text-${src}.mp4`)
        const ep2 = (await editParams(passName, inputDir, 'x')).params
        await run(base, outputDir, patchEdit(build(ep2), { lora: HEAD, picture: s.face, prompt: headSwapPrompt() }), `whole-text+head-${src}`)
      }
      return
    }

    if (PHASE === 'head') {
      for (const src of ['studio', 'gym']) {
        const ep = (await editParams(s[src], inputDir, 'x')).params
        await run(base, outputDir, patchEdit(build(ep), { lora: HEAD, picture: s.face, prompt: headSwapPrompt() }), `head-${src}`)
      }
      return
    }

    if (PHASE === 'outfit') {
      const src = s.studio
      // Full-size reference videos break the native route (noise; native2 phase): half size.
      const small = 'vr-src-studio-small.mp4'
      ff(['-i', path.join(inputDir, src), '-vf', 'scale=304:528', '-c:v', 'libx264', '-crf', '14', '-c:a', 'copy', path.join(inputDir, small)])
      await run(base, outputDir, await nativeWhole(small, 'studio'), 'whole-nativesmall-studio')
      const ep = (await editParams(src, inputDir, 'x')).params
      const { probe } = await editParams(src, inputDir, '')
      const legs: { what: string; text: string; ffp: string; native: Parameters<typeof nativePrompt>[0]; pic: string }[] = [
        {
          what: 'outfit', pic: s.outfit,
          text: 'vfx_edit: Change her golden bikini into an emerald-green sequined two-piece bikini, while preserving her identity, hair, body, pose, motion, framing, lighting and the white background.',
          ffp: 'vfx_edit: <Picture 1> is the edited first frame. Change her golden bikini into the emerald-green sequined two-piece bikini shown in <Picture 1> for the whole clip, while preserving her identity, hair, body, pose, motion, framing, lighting and the white background.',
          native: {
            subject: '<Subject 1> is the emerald-green sequined two-piece bikini from <Picture 1>.',
            transfer: 'The woman of <Video 1> wears the bikini of <Subject 1> in place of her golden bikini; everything else is unchanged.',
            keep: 'the emerald-green sequined bikini from <Picture 1> is transferred onto the woman of <Video 1> for the whole clip.',
            body: '[Shot 1] At 00:00.000 The target video follows <Video 1> frame by frame: the same woman, face, hair, muscular body, poses, motion, camera, framing, lighting and white background. Only her golden bikini is replaced by <Subject 1>, the emerald-green sequined two-piece bikini from <Picture 1>, which stays consistent in every frame.',
          },
        },
        {
          what: 'location', pic: s.location,
          text: 'vfx_edit: Change the white studio background into a tropical beach at sunset with palm trees and calm sea, while preserving her identity, hair, body, bikini, pose, motion and framing.',
          ffp: 'vfx_edit: <Picture 1> is the edited first frame. Change the white studio background into the tropical sunset beach shown in <Picture 1> for the whole clip, while preserving her identity, hair, body, bikini, pose, motion and framing.',
          native: {
            subject: '<Subject 1> is the tropical beach at sunset from <Picture 1>, with palm trees, wet golden sand and a calm turquoise sea.',
            transfer: 'The woman of <Video 1> performs in the environment of <Subject 1> in place of the white studio background; she and her motion are unchanged.',
            keep: 'the beach environment from <Picture 1> replaces the white studio background of <Video 1> for the whole clip.',
            body: '[Shot 1] At 00:00.000 The target video follows <Video 1> frame by frame: the same woman, face, hair, muscular body, golden bikini, poses, motion, camera and framing. The white studio background is replaced by <Subject 1>, the tropical beach at sunset from <Picture 1>, with warm sunset light falling on her.',
          },
        },
      ]
      for (const leg of legs) {
        await run(base, outputDir, patchEdit(build(ep), { prompt: leg.text }), `${leg.what}-text`)
        await run(base, outputDir, patchEdit(build(ep), { lora: FFP, picture: s[`ff-${leg.what}-studio`], prompt: leg.ffp }), `${leg.what}-ffp`)
        await run(base, outputDir, build({
          ...common, mode: 'ref2v', seed: SEED, orientation: 'portrait', durationSeconds: Math.min(15, probe.durationSec),
          refImages: [leg.pic], refVideos: [small], prompt: nativePrompt(leg.native),
        } as VideoGenerationParams), `${leg.what}-native`)
      }
      return
    }

    if (PHASE === 'split') {
      const src = s.long
      const prompt = 'vfx_edit: Change her black sports bra and grey leggings into a bright red sports bra and bright red leggings, while preserving her identity, hair, body, pose, motion, framing, lighting and the park.'
      const { probe } = await editParams(src, inputDir, 'x')
      const total = framesFromDuration(probe.durationSec)
      const A = h3EditFrames(Number(process.env.VR_CHUNK ?? 240))! // chunk A on the grid
      record('split:frames', { total, A })
      // Speed: 5 / 10 / 15 s edits of the same source, seconds per delivered second.
      for (const n of process.env.VR_CHUNK ? [A] : [h3EditFrames(120)!, A, h3EditFrames(362)!]) {
        const ep = (await editParams(src, inputDir, prompt, { frames: n })).params
        const r = await run(base, outputDir, patchEdit(build(ep), { prompt }), `split-len-${n}`)
        record(`split:speed:${n}`, { frames: n, seconds: r.seconds, perSecond: r.seconds / (n / 24) })
      }
      const chunkA = path.join(DIR, `split-len-${A}.mp4`)
      // Chunk B starts on chunk A's last frame (one frame overlap, dropped at the join).
      const startB = A - 1
      const restB = h3EditFrames(Math.min(process.env.VR_CHUNK ? A : 362, total - startB))!
      // S1 independent.
      const b1 = (await editParams(src, inputDir, prompt, { frames: restB })).params
      await run(base, outputDir, patchEdit(build(b1), { prompt, skip: startB }), `split-b-independent${process.env.VR_CHUNK ? '-' + A : ''}`)
      // S2 FFP: chunk A's last edited frame is chunk B's <Picture 1>.
      frameOut(chunkA, path.join(inputDir, 'vr-split-lastA.png'), { last: true })
      await run(base, outputDir, patchEdit(build(b1), {
        lora: FFP, picture: 'vr-split-lastA.png', skip: startB,
        prompt: 'vfx_edit: <Picture 1> is the edited first frame. Change her black sports bra and grey leggings into the bright red sports bra and bright red leggings shown in <Picture 1>, while preserving her identity, hair, body, pose, motion, framing, lighting and the park.',
      }), `split-b-ffp${process.env.VR_CHUNK ? '-' + A : ''}`)
      // S3 masked prefix: chunk A's last 39 edited frames frozen at the head of chunk B.
      const startM = A - 39
      const restM = h3EditFrames(Math.min(process.env.VR_CHUNK ? A + 39 : 362, total - startM))!
      const bm = (await editParams(src, inputDir, prompt, { frames: restM })).params
      const wf = patchEdit(build(bm), { prompt, skip: startM })
      const prevRel = 'vr-split-chunkA.mp4'
      fs.copyFileSync(chunkA, path.join(outputDir, prevRel))
      const cond = idOf(wf, 'MiniMaxH3ReferenceToVideo')
      const save = idOf(wf, 'CreateVideo')
      wf['vr:prevload'] = { class_type: 'LoadVideo', _meta: { title: 'chunk A' }, inputs: { file: `${prevRel} [output]` } }
      wf['vr:prevsplit'] = { class_type: 'GetVideoComponents', _meta: { title: 'chunk A parts' }, inputs: { video: ['vr:prevload', 0] } }
      wf['vr:prefix'] = {
        class_type: 'RaccoonH3MaskedPrefix', _meta: { title: 'freeze chunk A tail' },
        inputs: {
          latent: [cond, 1], vae: wf[idOf(wf, 'VAEDecode')].inputs.vae, audio_vae: wf[idOf(wf, 'VAEDecodeAudio')].inputs.vae,
          video: ['vr:prevsplit', 0], audio: ['vr:prevsplit', 1], context_frames: 39,
        },
      }
      wf[idOf(wf, 'SamplerCustomAdvanced')].inputs.latent_image = ['vr:prefix', 0]
      wf['vr:cut'] = { class_type: 'ImageFromBatch', _meta: { title: 'drop frozen head' }, inputs: { image: wf[save].inputs.images, batch_index: 39, length: 4096 } }
      wf[save].inputs.images = ['vr:cut', 0]
      delete wf[save].inputs.audio // the final mux puts the source's own sound back
      await run(base, outputDir, wf, `split-b-masked${process.env.VR_CHUNK ? '-' + A : ''}`)
      record('split:chunks', { startB, restB, startM, restM })
      return
    }

    throw new Error(`unknown VR_PHASE ${PHASE}`)
  }, 4 * 60 * 60_000)
})

/** The author's template; the facial-details line written from pic-face.png. */
function headSwapPrompt(): string {
  return [
    'head_swap:',
    '',
    'subject_definitions:',
    '',
    '<Subject 1> is the reference head identity from <Picture 1>, including the complete head, facial identity, facial structure, head shape, hairstyle, hairline, skin appearance, proportions, and all distinctive visual features.',
    '',
    'Facial details of <Subject 1>:',
    process.env.VR_FACE ?? 'Female, around fifty, oval face with defined cheekbones and a firm jawline, tanned skin, blue-grey eyes, short silver pixie cut swept to one side, light smile lines, no jewelry or glasses',
    '',
    '<Subject 2> is the original person in <Video 1>, whose body, neck, clothing, pose, physical proportions below the head, actions, motion, timing, and interaction with the environment must remain unchanged.',
    '',
    '<Video 1> is the source video for the target video edit, providing the original body performance, motion, camera movement, framing, timing, lighting, environment, scene composition, and temporal structure.',
    '',
    'summary:',
    '',
    '[video editing + reference generation]',
    '',
    "The target video is an edited version of <Video 1>. Replace only the entire head of <Subject 2> with the reference head identity defined by <Subject 1> from <Picture 1>. Preserve the source video's body, clothing, performance, motion, camera behavior, environment, lighting, timing, and composition.",
    '',
    'retention_analysis:',
    '',
    '<Subject 1> (appears throughout the target video): attribute_transfer - the complete head identity from <Picture 1>, including facial identity, facial structure, hairstyle, head shape, proportions, skin appearance, and distinctive features, is transferred consistently onto the body of <Subject 2>.',
    '',
    '<Subject 2> (appears throughout the target video): partially_preserved - the original body, neck position, clothing, pose, motion, gestures, actions, and physical performance are preserved, while only the original head is replaced.',
    '',
    '<Video 1> (entire target timeline): partially_preserved - the original video timing, body motion, camera movement, framing, lighting, background, environment, scene composition, and temporal structure are preserved; only the subject\'s head appearance is modified.',
    '',
    'detailed_description:',
    '',
    'Preserve <Video 1> as the complete temporal and compositional foundation of the target video. <Subject 2> retains the exact original body, clothing, pose, body proportions, movement, gestures, actions, speed, timing, and interaction with the environment.',
    '',
    'Replace only the entire original head of <Subject 2> with <Subject 1>, the reference head identity from <Picture 1>. Preserve the complete recognizable identity of <Subject 1>, including facial structure, skull and head shape, hairstyle, hairline, skin appearance, facial proportions, eyes, eyebrows, nose, mouth, jawline, ears, and distinctive identifying features.',
    '',
    'The transferred head follows the original head motion and performance of <Subject 2> throughout <Video 1>, including head rotation, tilt, pitch, yaw, natural translation, facial orientation, gaze direction, and perspective changes. Maintain anatomically correct head scale and a seamless connection between the transferred head and the original neck.',
    '',
    'Preserve the lighting conditions of <Video 1> on the transferred head. Maintain strong temporal consistency across every frame. Do not alter the body, clothing, hands, pose, gestures, action, background, objects, environment, camera trajectory, framing, lens behavior, scene timing, or composition inherited from <Video 1>.',
    '',
    'overall_soundscape:',
    '',
    'Preserve the original audiovisual timing and visible action structure of <Video 1>. No visual modifications are made outside the head replacement.',
    '',
    'non_diegetic_music:',
    'N/A',
  ].join('\n')
}
