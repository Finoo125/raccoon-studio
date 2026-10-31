/**
 * Does a face close-up beside a character sheet hold a reference-mode face
 * better? Replays the owner's 2026-10-10 22:43 ref2v job (Qwen 2.1 Edit sheet
 * of a Krea2 photo + outfit + location + prop, Hybrid checkpoint, refHiFi,
 * realism, grain, sharpen) with a brief that frames the face, and adds a face
 * close-up made by Qwen 2.1 Edit from the same Krea2 photo.
 *
 * Legs (each × FACEREF_SEEDS, everything else identical):
 *   ctrl     — the four references, plain typed brief (how the owner prompts)
 *   face     — + the close-up as a second Character picture (sorted to <Picture 2>)
 *   ctrlTag  — four references, the brief written through the tags as the
 *              doctrine would (declaration line + binding sentences)
 *   faceTag  — five references, the same tagged brief + what a Face role would
 *              add: `<Picture 2> is attribute_transfer` and "with the face from
 *              <Picture 2>: the same woman, seen close up"
 *
 * Phases, FACEREF_PHASE=face|check|h3|score, all under FACEREF_DIR:
 *   face  — two Qwen Edit close-ups, ArcFace vs the Krea2 photo, best → input/
 *   check — the builder reproduces the original job's embedded graph
 *   h3    — the renders (resumable: done leg×seed pairs are skipped)
 *   score — every 3rd frame, ArcFace of the largest face vs the Krea2 photo
 *
 *   FACEREF_DIR=<dir> FACEREF_PHASE=h3 LIVE_RENDER=1 \
 *     node_modules/.bin/vitest run src/lib/workflows/h3-face-ref-ab.live.test.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { workflows } from './index'
import { minimaxH3Workflow } from './minimax-h3'
import { liveEnv, renderGraph } from './live-render'
import type { VideoGenerationParams } from '@/types/video-workflow'
import type { GenerationParams } from '@/types/workflow'
import type { ComfyUIPromptNode } from '@/types/comfyui'

const LIVE = process.env.LIVE_RENDER === '1'
const DIR = process.env.FACEREF_DIR ?? ''
const PHASE = process.env.FACEREF_PHASE ?? ''
const SEEDS = (process.env.FACEREF_SEEDS ?? '8177135924500,1111,2222').split(',').map(Number)
const ONLY = process.env.FACEREF_LEGS?.split(',').filter(Boolean)

const SRC = 'qwen-edit-mv2yfh4xok87sth8.png' // the Krea2 photo the sheet was made from
const SHEET = '001756-QWEN21__00001_.png'
const FACE = 'faceref-closeup.png'
const [OUTFIT, LOCATION, PROP] = ['002805-KREA2__00001_.png', '000129-KREA2__00001_.png', '000259-KREA2__00001_.png']

const FACE_INSTRUCTION =
  'close-up portrait photograph of the woman in picture 1: head and shoulders, facing the camera, ' +
  'the same face, the same freckles, the same eyes and the same hair, neutral expression, ' +
  'soft even studio light, plain light grey background, sharp details'

const PLAIN =
  'POV shot, chest-level, medium close-up. Hannah stands waist-deep in the lagoon, the waterfall behind her. ' +
  'She holds the red vial up beside her face, smiles into the camera and says, "Found it. Want to try?" ' +
  'She turns her head to glance at the waterfall, then looks back into the lens and laughs softly. ' +
  'Cut to a close-up of her face as she uncaps the vial and raises an eyebrow. ' +
  'Gentle lagoon water, the soft rush of the waterfall.'

/** The plain brief written through the tags, as the roled doctrine would; `face` adds only the Face-role parts. */
function tagged(face: boolean): string {
  const P = (i: number) => `<Picture ${i}>`
  const k = face ? 1 : 0
  const [out, loc, prop] = [P(2 + k), P(3 + k), P(4 + k)]
  const markers = face
    ? ['partially_preserved', 'attribute_transfer', 'attribute_transfer', 'fully_preserved', 'fully_preserved']
    : ['partially_preserved', 'attribute_transfer', 'fully_preserved', 'fully_preserved']
  const decl = 'For the target video, the attached references are used as follows: ' +
    markers.map((m, i) => `${P(i + 1)} is ${m}.`).join(' ')
  const bind =
    `The character in every shot is the person from <Picture 1>${face ? ', with the face from <Picture 2>: the same woman, seen close up' : ''}. ` +
    `The character wears the outfit from ${out} in every shot, in place of the clothes in <Picture 1>. ` +
    `The setting is the place from ${loc}. The object in the scene is the object from ${prop}.`
  return [
    decl,
    '',
    'integrated_multimodal_description:',
    `${bind} [Shot 1] At 00:00.000 POV shot, chest-level, medium close-up. The person from <Picture 1> stands waist-deep in the place from ${loc}, ` +
      `the waterfall behind her, wearing the outfit from ${out}. She holds the object from ${prop} up beside her face, smiles into the camera and says: ` +
      '<d>Found it. Want to try?</d> She turns her head to glance at the waterfall, then looks back into the lens and laughs softly.',
    `[Shot 2] At 00:06.000 Close-up of the face of the person from <Picture 1> as she uncaps the object from ${prop} and raises an eyebrow.`,
    '',
    'overall_soundscape:',
    'Gentle lagoon water lapping, the soft rush of the waterfall, her quiet laugh.',
    '',
    'non_diegetic_music:',
    'N/A',
  ].join('\n')
}

type Wf = Record<string, ComfyUIPromptNode>
const nodesOf = (wf: Wf, cls: string) => Object.values(wf).filter((n) => n.class_type === cls)
const nodeOf = (wf: Wf, cls: string) => nodesOf(wf, cls)[0]

const jobParams = () => JSON.parse(fs.readFileSync(path.join(DIR, 'job-params.json'), 'utf8')) as VideoGenerationParams

function legParams(leg: string, seed: number): VideoGenerationParams {
  // The shipped feature, through the production builder: the typed brief, the
  // builder writes the declaration + binding (h3TypedBriefBinding).
  if (leg === 'ctrlBind' || leg === 'faceRole') {
    const face = leg === 'faceRole'
    return {
      ...jobParams(),
      seed,
      prompt: PLAIN,
      refImages: face ? [SHEET, OUTFIT, LOCATION, PROP, FACE] : [SHEET, OUTFIT, LOCATION, PROP],
      refImageRoles: face ? ['character', 'outfit', 'location', 'prop', 'face'] : ['character', 'outfit', 'location', 'prop'],
    }
  }
  const face = leg.startsWith('face')
  return {
    ...jobParams(),
    seed,
    prompt: leg.endsWith('Tag') ? tagged(face) : PLAIN,
    refImages: face ? [SHEET, OUTFIT, LOCATION, PROP, leg === 'faceCrop' ? FACE_HEAD : FACE] : [SHEET, OUTFIT, LOCATION, PROP],
    refImageRoles: face ? ['character', 'outfit', 'location', 'prop', 'character'] : ['character', 'outfit', 'location', 'prop'],
  }
}
// faceCrop — added after seed 1 showed `face` losing the outfit to the close-up's
// white top: the same close-up cropped to the head (no clothes), plain brief.
const FACE_HEAD = 'faceref-head.png'
// ctrl/face/faceCrop were rendered BEFORE the typed-brief binding existed; built
// today their typed brief would be bound too. Their rows in results.json are the
// pre-binding baseline; ctrlBind/faceRole are the same pictures after it.
const LEGS = ['ctrl', 'face', 'ctrlTag', 'faceTag', 'faceCrop', 'ctrlBind', 'faceRole']

/** Picture order the node actually receives: LoadImage files behind each ref_image_N, unwrapping the headless crop. */
function refOrder(wf: Wf): string[] {
  const cond = nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!.inputs
  return Object.keys(cond)
    .filter((k) => k.startsWith('ref_images.'))
    .sort()
    .map((k) => {
      let n = wf[String((cond[k] as [string, number])[0])]
      if (n.class_type === 'RaccoonHeadlessReference') n = wf[String((n.inputs.image as [string, number])[0])]
      return String(n.inputs.image)
    })
}

const free = () =>
  fetch(`${liveEnv().base}/free`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  }).catch(() => {})

const SCORER = `
import json, sys, os, glob
sys.path.insert(0, os.environ['PACK_DIR'])
import cv2, numpy as np
import analyzer
A = analyzer.Analyzer(os.path.join(os.environ['MODELS_DIR'], 'insightface', 'models', 'buffalo_l'))
def load(p): return cv2.imdecode(np.fromfile(p, np.uint8), cv2.IMREAD_COLOR)
def area(f): return (f.bbox[2]-f.bbox[0])*(f.bbox[3]-f.bbox[1])
refs = json.loads(sys.argv[1])
R = {}
for k, p in refs.items():
    fs = A.get(load(p))
    R[k] = max(fs, key=area).normed_embedding
out = {'refs': {k: {j: float(np.dot(R[k], R[j])) for j in R} for k in R}}
for d in sys.argv[2:]:
    rows = []
    for p in sorted(glob.glob(os.path.join(d, '*.png'))):
        fs = A.get(load(p))
        if not fs:
            rows.append(None); continue
        f = max(fs, key=area)
        rows.append(dict(w=float(f.bbox[2]-f.bbox[0]), n=len(fs), **{k: float(np.dot(e, f.normed_embedding)) for k, e in R.items()}))
    out[d] = rows
print(json.dumps(out))
`

function score(refs: Record<string, string>, dirs: string[]) {
  const { repoRoot, modelsDir } = liveEnv()
  const script = path.join(DIR, '_score.py')
  fs.writeFileSync(script, SCORER)
  const py = path.join(repoRoot, 'comfyui/ComfyUI/.venv/Scripts/python.exe')
  const stdout = execFileSync(py, [script, JSON.stringify(refs), ...dirs], {
    env: { ...process.env, PACK_DIR: path.join(repoRoot, 'comfyui/ComfyUI/custom_nodes/RaccoonSwapNodes'), MODELS_DIR: modelsDir },
    maxBuffer: 64 << 20,
  }).toString()
  return JSON.parse(stdout.trim().split('\n').pop()!)
}

describe.skipIf(!LIVE)('H3 reference mode: face close-up beside a character sheet', () => {
  it(`phase ${PHASE}`, async () => {
    expect(DIR, 'set FACEREF_DIR').toBeTruthy()
    const { base, outputDir, inputDir } = liveEnv()

    if (PHASE === 'face') {
      await free()
      const edit = workflows.find((w) => w.id === 'qwen21-edit')!
      const made: string[] = []
      for (const s of [1, 2]) {
        const wf = edit.buildPrompt({
          width: 832, height: 1216, upscale: false, detailer: false,
          prompt: FACE_INSTRUCTION, qwenReferences: [SRC], seed: 4240 + s,
        } as GenerationParams)
        const { files } = await renderGraph(base, wf, `face${s}`, outputDir)
        const file = path.join(DIR, `face${s}.png`)
        fs.copyFileSync(files[0], file)
        made.push(file)
      }
      const r = score({ src: path.join(inputDir, SRC), sheet: path.join(inputDir, SHEET) }, [])
      // Score each candidate on its own: the scorer reads directories, so stage one per dir.
      const per = made.map((f, i) => {
        const d = path.join(DIR, `_face${i + 1}`)
        fs.mkdirSync(d, { recursive: true })
        fs.copyFileSync(f, path.join(d, 'x.png'))
        return score({ src: path.join(inputDir, SRC) }, [d])[d][0]?.src as number
      })
      console.log(`[face] sheet vs src ${r.refs.src.sheet.toFixed(3)}; close-ups vs src ${per.map((x) => x.toFixed(3)).join(' / ')}`)
      const best = made[per.indexOf(Math.max(...per))]
      fs.copyFileSync(best, path.join(inputDir, FACE))
      fs.writeFileSync(path.join(DIR, 'face.json'), JSON.stringify({ sheetVsSrc: r.refs.src.sheet, closeups: per, picked: best }, null, 2))
      return
    }

    if (PHASE === 'check') {
      const orig = JSON.parse(fs.readFileSync(path.join(DIR, 'graph-004702.json'), 'utf8')) as Wf
      // ComfyUI stamps file hashes onto loaders at execution; the builder never emits them.
      for (const n of Object.values(orig)) delete (n as { is_changed?: unknown }).is_changed
      const wf = minimaxH3Workflow.buildPrompt(jobParams()) as Wf
      // Since the typed-brief binding, the original's typed prompt is bound: the
      // graph matches except for the text in front of the brief.
      const promptOf = (g: Wf) => String(nodeOf(g, 'MiniMaxH3ReferenceToVideo')!.inputs.prompt)
      expect(promptOf(wf).endsWith(jobParams().prompt)).toBe(true)
      nodeOf(wf, 'MiniMaxH3ReferenceToVideo')!.inputs.prompt = promptOf(orig)
      expect(wf).toEqual(orig)
      console.log(String(nodeOf(minimaxH3Workflow.buildPrompt(legParams('faceRole', 1)) as Wf, 'MiniMaxH3ReferenceToVideo')!.inputs.prompt))
      for (const leg of LEGS) {
        const w = minimaxH3Workflow.buildPrompt(legParams(leg, 1)) as Wf
        console.log(`[check] ${leg}: ${refOrder(w).join(' | ')}`)
        expect(refOrder(w)).toEqual(leg.startsWith('face')
          ? [SHEET, leg === 'faceCrop' ? FACE_HEAD : FACE, OUTFIT, LOCATION, PROP] : [SHEET, OUTFIT, LOCATION, PROP])
        expect(String(nodeOf(w, 'MiniMaxH3ReferenceToVideo')!.inputs.prompt)).toContain(leg.endsWith('Tag') ? '<Picture 1>' : 'Hannah')
      }
      console.log(tagged(true))
      return
    }

    if (PHASE === 'h3') {
      const file = path.join(DIR, 'results.json')
      const results: Record<string, unknown>[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
      for (const seed of SEEDS) {
        for (const leg of LEGS.filter((l) => !ONLY || ONLY.includes(l))) {
          if (results.some((r) => r.leg === leg && r.seed === seed)) continue
          await free()
          const wf = minimaxH3Workflow.buildPrompt(legParams(leg, seed)) as Wf
          expect(nodeOf(wf, 'RandomNoise')!.inputs.noise_seed).toBe(seed)
          const started = Date.now()
          const r = await fetch(`${base}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: wf, client_id: 'raccoon-faceref-ab' }),
          })
          const body = await r.json()
          expect(r.status, JSON.stringify(body).slice(0, 1200)).toBe(200)
          let outs: { filename: string; subfolder: string }[] = []
          for (;;) {
            await new Promise((res) => setTimeout(res, 5000))
            const entry = (await (await fetch(`${base}/history/${body.prompt_id}`)).json())?.[body.prompt_id]
            if (entry?.status?.status_str === 'error') throw new Error(JSON.stringify(entry.status).slice(0, 1500))
            if (entry?.status?.completed) {
              outs = Object.values(entry.outputs ?? {}).flatMap((o) => Object.values(o as Record<string, unknown[]>).flat()) as typeof outs
              break
            }
            if (Date.now() - started > 40 * 60_000) throw new Error('render timed out')
          }
          const vid = outs.find((o) => /\.mp4$/i.test(o.filename))!
          const row = { leg, seed, file: path.join(outputDir, vid.subfolder, vid.filename), seconds: Math.round((Date.now() - started) / 1000) }
          console.log(`[faceref] ${leg} seed ${seed} -> ${vid.filename} in ${row.seconds}s`)
          results.push(row)
          fs.writeFileSync(file, JSON.stringify(results, null, 2))
        }
      }
      return
    }

    if (PHASE === 'score') {
      const results = JSON.parse(fs.readFileSync(path.join(DIR, 'results.json'), 'utf8')) as { leg: string; seed: number; file: string; seconds: number }[]
      const dirs = results.map((r) => {
        const d = path.join(DIR, 'frames', `${r.leg}_${r.seed}`)
        fs.rmSync(d, { recursive: true, force: true })
        fs.mkdirSync(d, { recursive: true })
        execFileSync('ffmpeg', ['-v', 'error', '-i', r.file, '-vf', "select='not(mod(n\\,3))'", '-vsync', 'vfr', path.join(d, '%04d.png')])
        // Contact strip at 1, 3, 5, 7, 9 s for the eye (twins, wrong person).
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', r.file, '-vf', "select='eq(n\\,24)+eq(n\\,72)+eq(n\\,120)+eq(n\\,168)+eq(n\\,216)',scale=240:-2,tile=5x1", '-frames:v', '1', path.join(DIR, `strip_${r.leg}_${r.seed}.png`)])
        return d
      })
      const s = score({ src: path.join(inputDir, SRC), face: path.join(inputDir, FACE) }, dirs)
      const MIN_W = 40
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || NaN)
      const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]
      const rows = results.map((r, i) => {
        const fr = (s[dirs[i]] as ({ w: number; n: number; src: number; face: number } | null)[])
        const ok = fr.filter((f): f is NonNullable<typeof f> => !!f && f.w >= MIN_W)
        const src = ok.map((f) => f.src)
        return { leg: r.leg, seed: r.seed, seconds: r.seconds, frames: fr.length, scored: ok.length, multi: ok.filter((f) => f.n > 1).length,
          mean: mean(src), p10: pct(src, 0.1), min: Math.min(...src), meanFace: mean(ok.map((f) => f.face)), medianW: pct(ok.map((f) => f.w), 0.5) }
      })
      fs.writeFileSync(path.join(DIR, 'scores.json'), JSON.stringify({ refs: s.refs, rows }, null, 2))
      const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '—')
      const lines = rows.map((r) => `| ${r.leg} | ${r.seed} | ${f3(r.mean)} | ${f3(r.p10)} | ${f3(r.min)} | ${f3(r.meanFace)} | ${r.scored}/${r.frames} | ${r.multi} | ${r.medianW?.toFixed(0)} | ${r.seconds} s |`)
      const legRows = LEGS.map((l) => {
        const rs = rows.filter((r) => r.leg === l)
        return `| **${l}** | ${rs.length} seeds | ${f3(mean(rs.map((r) => r.mean)))} | ${f3(mean(rs.map((r) => r.p10)))} | ${f3(Math.min(...rs.map((r) => r.min)))} | ${f3(mean(rs.map((r) => r.meanFace)))} | | ${rs.reduce((a, r) => a + r.multi, 0)} | | ${mean(rs.map((r) => r.seconds)).toFixed(0)} s |`
      })
      const md = `| leg | seed | ArcFace vs photo (mean) | p10 | min | vs close-up | frames scored | >1 face | median face px | time |\n|---|---|---|---|---|---|---|---|---|---|\n${[...lines, ...legRows].join('\n')}\n\nrefs: ${JSON.stringify(s.refs)}\n`
      fs.writeFileSync(path.join(DIR, 'scores.md'), md)
      console.log(md)
      return
    }

    throw new Error(`unknown FACEREF_PHASE ${PHASE}`)
  }, 8 * 60 * 60_000)
})
