import type { ComfyUIPrompt, ComfyUIPromptNode } from '@/types/comfyui'
import type { VideoWorkflowDefinition, VideoGenerationParams } from '@/types/video-workflow'
import baseWorkflow from '../../../workflows/MinimaxH3.json'
import { appendFilmGrain } from './film-grain'

type Wf = Record<string, ComfyUIPromptNode>
const BASE = baseWorkflow as unknown as Wf

/** Id of the single node of `cls` in the base workflow — throws at module load if not exactly one. */
function idOf(cls: string): string {
  const ids = Object.keys(BASE).filter((k) => BASE[k].class_type === cls)
  if (ids.length !== 1) throw new Error(`MinimaxH3.json: expected 1 ${cls}, found ${ids.length}`)
  return ids[0]
}

const COND_ID = idOf('MiniMaxH3ImageToVideo')
const IMAGE_ID = idOf('LoadImage')
const NOISE_ID = idOf('RandomNoise')
const VIDEO_ID = idOf('CreateVideo')
const MODEL_ID = idOf('UNETLoader')
const SCHED_ID = idOf('BasicScheduler')
const GUIDER_ID = idOf('BasicGuider')
const DECODE_ID = idOf('VAEDecode')
const SAVE_ID = idOf('SaveVideo')
const AUDIO_ID = idOf('VAEDecodeAudio')

/**
 * Ids for nodes this builder adds, starting well clear of the base graph's 1–15.
 * Made fresh per build, not module-level: identical params must produce an
 * identical graph, or ComfyUI's execution cache treats every run as new work.
 */
const makeIds = () => {
  let n = 100
  return () => String(n++)
}

/**
 * The 4-step Turbo LoRA, as converted for ComfyUI's *pruned* H3 checkpoint —
 * which is the one we ship. drbaph's conversion is what lets it load through
 * core `LoraLoaderModelOnly`; larryvrh's original needs a custom node pack, and
 * that would cost this graph its no-custom-packs property.
 */
export const H3_TURBO_LORA = 'minimax_h3_turbo_4step_ckpt500_pruned_comfyui.safetensors'

/**
 * ref2va weights — a **separate 21 GB checkpoint**, not a flag on the fl2va one.
 * Same quantisation choice as the model we already ship: pruned int8 convrot,
 * deliberately not `pruned_fp8_scaled` (ten megabytes away in the HF listing,
 * and fp8_scaled is the format DynamicVRAM renders as tiled garbage).
 */
export const H3_REF2VA_CKPT = 'minimax_h3_ref2va_pruned_int8_convrot.safetensors'

/**
 * The references the node will actually see, in the order it will see them.
 *
 * Load-bearing, not cosmetic: `execute` iterates the slots it received and skips
 * empties, so `<Picture i>` counts *presentation* order. A gap in the UI slots
 * would otherwise promote slot 3 to `<Picture 2>` and silently break a prompt
 * that says `<Picture 3>`. Both the builder and the slot labels go through here
 * so the two can never disagree. The same rule governs `<Video i>`/`<Audio i>`.
 */
export const compactRefs = (refs?: (string | undefined)[]): string[] =>
  (refs ?? []).filter((f): f is string => !!f)

/**
 * One shared budget across all three reference types, not a cap per type.
 *
 * The node's own ceilings are 9 images / 3 videos / 3 audio, but references
 * compete for the same thing — every one of them rides through every sampling
 * step — so what matters to a render is the total. MiniMax's guide is blunt
 * that more references do not make a better video and each should have a single
 * clear job, so six is generous rather than limiting.
 */
export const H3_REF_BUDGET = 6

/**
 * Per-type ceilings, which the budget then further constrains. Images could go
 * to 9 but the budget caps them first; videos and audio are the node's own hard
 * limits and must not be raised.
 */
export const H3_REF_MAX = { images: 6, videos: 3, audios: 3 } as const

/** How many reference slots of all kinds are filled, against `H3_REF_BUDGET`. */
export const h3RefCount = (p: {
  refImages?: (string | undefined)[]
  refVideos?: (string | undefined)[]
  refAudios?: (string | undefined)[]
}): number =>
  compactRefs(p.refImages).length + compactRefs(p.refVideos).length + compactRefs(p.refAudios).length

/**
 * Steps per mode.
 *
 * 6 sits just above the author's floor of 4 ("any count ≥ 4 is valid; more steps
 * still help a little"). Turbo is positioned as a *testing* mode here rather
 * than a quality one — you use it to find a prompt and a seed, then render the
 * keeper without it — so speed is the point and the artefacts are accepted.
 */
export const H3_STEPS = { normal: 20, turbo: 6 } as const

/**
 * Default Draft-mode LoRA strength.
 *
 * 0.9, not the 1.0 the LoRA was trained at: strength is the author's own dial
 * for the sharpness/artefact trade — "if it shows over-sharp grain / artefacts,
 * nudge it down (0.8–0.95)" — and over-sharpness is exactly what these preview
 * weights are criticised for. Fixed, not exposed: Draft mode is a throwaway
 * preview, and a knob on a throwaway is one more thing to get wrong. Change it
 * here if the weights are ever retrained.
 */
export const H3_TURBO_STRENGTH = 0.9

/**
 * Film-grain intensity for video. Started above the stills' 0.04 on the theory
 * that motion hides fine texture; on real clips it just read heavy, so it is
 * back to the same number the stills use. Anything near 0.1 visibly desaturates
 * the frame, so tune downward from here, not up.
 */
export const H3_GRAIN_INTENSITY = 0.04

/**
 * Sigma shift used with Turbo, from the same reference workflow (12 / 6).
 * `shift_audio` 6 is double the node's own default — the distilled schedule
 * moves the audio stream's noise level with it, and leaving audio at 3 while
 * video runs at 12 is what desynchronises the two streams at low step counts.
 * Applied only in Turbo; the base graph keeps the model's baked-in schedule.
 */
const TURBO_SHIFT = { video: 12, audio: 6 }

/** Frames per second RIFE interpolates up to. Exactly 2x H3's fixed 24. */
export const H3_RIFE_FPS = 48

/**
 * H3 renders at 24 fps and nothing else: the model's flow schedule and its
 * 17k+5 frame grid are both defined against 24. `params.fps` is therefore
 * ignored by this builder rather than passed through — a 30 fps request would
 * silently change the clip's duration, not its smoothness.
 */
export const H3_FPS = 24

/** Model's own ceiling, from the H3 docs: short edge ≤768, long edge ≤1344. */
const MAX_SHORT = 768
const MAX_LONG = 1344

export type Tier = NonNullable<VideoGenerationParams['vramMode']>

/** Legacy/unknown stored values render at the documented default. */
export const tierOf = (m?: string): Tier => (m === 'high' || m === 'medium' ? m : 'low')

/**
 * Pixel budget per tier.
 *
 * `low` is ComfyUI's own shipped default (0.4 MP — the `ResolutionSelector` in
 * every official H3 template), which the Comfy blog says runs on a 3060, so it
 * is the safe floor for the 16 GB tier rather than a guess. The two tiers above
 * it scale toward the model's ~1 MP cap.
 *
 * ponytail: the 0.6/0.8 steps are interpolated, not measured — no live H3 render
 * has happened yet. Re-tune all three from a real VRAM trace before trusting
 * them; the shape of the knob is right even if the numbers move.
 */
export const BUDGET_MP: Record<Tier, number> = { low: 0.4, medium: 0.6, high: 0.8 }

/**
 * Frame count for a duration, snapped up to H3's 17k+5 grid at 24 fps.
 *
 * This is the `ComfyMathExpression` from the official templates
 * (`max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17`) done in
 * TypeScript instead — which drops both that node and `PrimitiveFloat` from the
 * graph, and with them the only dependency this workflow would have had on a
 * custom node pack. 5 s → 124 frames, matching the documented figure.
 */
export function h3FrameCount(durationSeconds: number): number {
  const raw = Math.max(5, Math.round(durationSeconds * H3_FPS))
  // Python's `%` floors (result takes the divisor's sign); JavaScript's takes
  // the dividend's. Transcribing the expression literally therefore rounds the
  // frame count *down* whenever `raw % 17 > 5` — 1 s came out as 22 frames
  // instead of 39, a shorter clip than asked for and a different length than
  // ComfyUI's own template produces. Hence the explicit positive modulo.
  const mod = (n: number, m: number) => ((n % m) + m) % m
  return raw + mod(5 - (raw % 17), 17)
}

/**
 * Fit `aspect` (w/h) into `budgetMp` megapixels, snapped to /32 as H3 requires,
 * then clamped to the model's canvas. Clamping happens after the snap and
 * re-snaps, so a clamped result is still a legal multiple of 32.
 */
export function h3Dims(aspect: number, budgetMp: number): { w: number; h: number } {
  const snap = (n: number) => Math.max(32, Math.round(n / 32) * 32)
  let h = snap(Math.sqrt((budgetMp * 1024 * 1024) / aspect))
  let w = snap(h * aspect)
  // Cap the short and long edges independently, preserving aspect on the way down.
  const short = Math.min(w, h)
  const long = Math.max(w, h)
  const scale = Math.min(1, MAX_SHORT / short, MAX_LONG / long)
  if (scale < 1) {
    h = snap(h * scale)
    w = snap(w * scale)
  }
  return { w, h }
}

/**
 * t2v framings. H3 takes any aspect; these three mirror the framings the video
 * form already offers for LTX so the picker does not grow a second vocabulary.
 */
export const ORIENTATIONS: { label: string; value: string; aspect: number }[] = [
  { label: 'Portrait 9:16', value: 'portrait', aspect: 9 / 16 },
  { label: 'Landscape 16:9', value: 'landscape', aspect: 16 / 9 },
  { label: 'Square 1:1', value: 'square', aspect: 1 },
]

/** The four user LoRA slots, in order, skipping empty/None ones. */
function userLoras(params: VideoGenerationParams): { name: string; strength: number }[] {
  return ([1, 2, 3, 4] as const)
    .map((i) => ({
      name: params[`lora${i}`],
      strength: params[`lora${i}Strength`] ?? 1,
    }))
    .filter((l): l is { name: string; strength: number } => !!l.name && l.name !== 'None')
}

/**
 * Build the MODEL patch chain between the checkpoint and everything that reads
 * a model, and return the id the consumers should point at.
 *
 * Order matters: weight patches (LoRAs) first, then the sampling-schedule patch.
 * `MiniMaxH3SigmaShift` rewrites sigmas rather than weights, so a LoRA applied
 * after it would be patching an already-shifted model.
 */
function buildModelChain(
  wf: Wf,
  params: VideoGenerationParams,
  turbo: boolean,
  freshId: () => string,
): string {
  let head = MODEL_ID

  const link = (node: ComfyUIPromptNode): string => {
    const id = freshId()
    wf[id] = node
    head = id
    return id
  }

  const lora = (name: string, strength: number) =>
    link({
      class_type: 'LoraLoaderModelOnly',
      _meta: { title: 'LoRA' },
      inputs: { model: [head, 0], lora_name: name, strength_model: strength },
    })

  // The Turbo LoRA goes on first so a user LoRA stacks on top of it, the same
  // way LTX layers the stack over its built-in distillation LoRA.
  if (turbo) lora(H3_TURBO_LORA, H3_TURBO_STRENGTH)
  for (const l of userLoras(params)) lora(l.name, l.strength)

  if (turbo) {
    link({
      class_type: 'MiniMaxH3SigmaShift',
      _meta: { title: 'MiniMax H3 Sigma Shift' },
      inputs: { model: [head, 0], shift_video: TURBO_SHIFT.video, shift_audio: TURBO_SHIFT.audio },
    })
  }
  return head
}

/** Rewire every consumer of `id`'s output away from it, then drop the node. */
function spliceOut(wf: Wf, id: string) {
  for (const node of Object.values(wf)) {
    for (const [k, v] of Object.entries(node.inputs)) {
      if (Array.isArray(v) && v[0] === id) delete node.inputs[k]
    }
  }
  delete wf[id]
}

export const minimaxH3Workflow: VideoWorkflowDefinition = {
  id: 'minimax-h3',
  name: 'MiniMax H3 Video',
  description: 'Text- and image-to-video with natively synced stereo audio, 24 fps',
  orientations: ORIENTATIONS.map(({ label, value }) => ({ label, value })),
  defaultParams: {
    mode: 't2v',
    orientation: 'landscape',
    durationSeconds: 5,
    fps: H3_FPS,
    seed: -1,
    vramMode: 'low',
  },
  buildPrompt(params: VideoGenerationParams): ComfyUIPrompt {
    const wf = JSON.parse(JSON.stringify(baseWorkflow)) as Wf
    const cond = wf[COND_ID].inputs
    // Above the mode branch: ref2v allocates loader ids before the model chain does.
    const freshId = makeIds()

    cond.prompt = params.prompt
    cond.length = h3FrameCount(params.durationSeconds)
    wf[VIDEO_ID].inputs.fps = H3_FPS

    const tier = tierOf(params.vramMode)
    const budget = BUDGET_MP[tier]

    if (params.mode === 'i2v' && params.inputImage) {
      wf[IMAGE_ID].inputs.image = params.inputImage
      // Fit the render to the source aspect so the first frame is not distorted;
      // without recorded dims fall back to the chosen framing.
      const aspect =
        params.inputImageWidth && params.inputImageHeight
          ? params.inputImageWidth / params.inputImageHeight
          : (ORIENTATIONS.find((o) => o.value === params.orientation) ?? ORIENTATIONS[1]).aspect
      const d = h3Dims(aspect, budget)
      cond.width = d.w
      cond.height = d.h
    } else {
      // t2v and ref2v: `first_frame` is optional on the node, so dropping the
      // loader and the link is all it takes — there is no black-frame
      // placeholder to feed it, and passing one would tell the model to open on
      // black. ref2v has no source aspect either — its references never appear
      // as a frame — so both frame from the orientation picker.
      spliceOut(wf, IMAGE_ID)
      const o = ORIENTATIONS.find((x) => x.value === params.orientation) ?? ORIENTATIONS[1]
      const d = h3Dims(o.aspect, budget)
      cond.width = d.w
      cond.height = d.h
    }

    // Reference mode retypes the one conditioning node rather than forking the
    // JSON: `MiniMaxH3ReferenceToVideo` has the same two outputs in the same
    // order, so 14 of the 15 base nodes are already correct.
    if (params.mode === 'ref2v') {
      wf[MODEL_ID].inputs.unet_name = H3_REF2VA_CKPT
      wf[COND_ID].class_type = 'MiniMaxH3ReferenceToVideo'
      wf[COND_ID]._meta = { title: 'MiniMax H3 reference conditioning + latent' }
      // There is no `idOf('VAELoader')` — this graph has two, video and audio —
      // so the audio one is identified by its role: whatever VAEDecodeAudio
      // already reads. A hardcoded "4" would rot the moment the JSON is edited.
      cond.audio_vae = wf[AUDIO_ID].inputs.vae
      // 'max' is the 2048px reference pipeline. Reference tokens ride through
      // every sampling step, so the node's own tooltip warns it can be several
      // times slower — hence opt-in, never the default.
      cond.ref_image_size = params.refHiFi === true ? 'max' : 'match'
      // Dotted and 0-indexed: that is how ComfyUI serialises an Autogrow slot in
      // the API format (`finalize_prefix`, comfy_api/latest/_io.py:1019), and it
      // matches the socket names in ComfyUI's own r2v template. A wrong key is
      // accepted silently and the clip renders with no references at all.
      compactRefs(params.refImages).forEach((file, i) => {
        const id = freshId()
        wf[id] = {
          class_type: 'LoadImage',
          _meta: { title: `Reference <Picture ${i + 1}>` },
          inputs: { image: file },
        }
        cond[`ref_images.ref_image_${i}`] = [id, 0]
      })

      // A reference video enters as *frames*, so it needs the core pair
      // LoadVideo -> GetVideoComponents (outputs: images, audio, fps, bit_depth).
      compactRefs(params.refVideos).forEach((file, i) => {
        const load = freshId()
        wf[load] = {
          class_type: 'LoadVideo',
          _meta: { title: `Reference <Video ${i + 1}>` },
          inputs: { file },
        }
        const split = freshId()
        wf[split] = {
          class_type: 'GetVideoComponents',
          _meta: { title: `<Video ${i + 1}> frames + sound` },
          inputs: { video: [load, 0] },
        }
        cond[`ref_videos.ref_video_${i}`] = [split, 0]
        // The clip's own soundtrack, on the index-paired slot the node expects.
        // Wired unconditionally: a silent clip makes `GetVideoComponents` yield
        // None, ComfyUI passes None straight through a typed input, and the H3
        // node skips it (`if soundtrack is not None`). Verified live 2026-08-11
        // against a deliberately silent mp4 — so there is no "does it have
        // audio?" question to answer before building the graph.
        cond[`ref_video_audios.ref_video_audio_${i}`] = [split, 1]
      })

      compactRefs(params.refAudios).forEach((file, i) => {
        const id = freshId()
        wf[id] = {
          class_type: 'LoadAudio',
          _meta: { title: `Reference <Audio ${i + 1}>` },
          inputs: { audio: file },
        }
        cond[`ref_audios.ref_audio_${i}`] = [id, 0]
      })
    }

    wf[NOISE_ID].inputs.noise_seed =
      params.seed < 0 ? Math.floor(Math.random() * 0xffffffffffff) : params.seed

    // Turbo LoRA, user LoRA slots and the Turbo sigma shift all patch MODEL, so
    // everything that consumes one has to move to the end of that chain.
    // A seed-hunt candidate always renders in Turbo, whatever the toggle says:
    // the point of the hunt is to compare seeds cheaply, and the seed the user
    // picks is then re-rendered with `seedHunt: false` — which drops Turbo back
    // to whatever they actually chose. So the candidate and the final clip
    // deliberately differ in quality, and only the seed carries across.
    const hunting = params.seedHunt === true
    const turbo = hunting || params.turbo === true
    wf[SCHED_ID].inputs.steps = turbo ? H3_STEPS.turbo : H3_STEPS.normal
    const model = buildModelChain(wf, params, turbo, freshId)
    if (model !== MODEL_ID) {
      wf[SCHED_ID].inputs.model = [model, 0]
      wf[GUIDER_ID].inputs.model = [model, 0]
    }

    // RIFE doubles the frame count, so the container fps has to double with it
    // or the clip plays at half speed and drifts out of sync with its own audio
    // track — which H3 generates jointly and RIFE never sees.
    if (params.rife === true) {
      const rife = freshId()
      wf[rife] = {
        class_type: 'RIFEInterpolation',
        _meta: { title: 'RIFE Interpolation' },
        inputs: {
          images: [DECODE_ID, 0],
          source_fps: H3_FPS,
          target_fps: H3_RIFE_FPS,
          scale: 1,
        },
      }
      wf[VIDEO_ID].inputs.images = [rife, 0]
      wf[VIDEO_ID].inputs.fps = H3_RIFE_FPS
    }

    // Film grain, same node the image families use at a near-identical intensity
    // (see H3_GRAIN_INTENSITY) — the
    // point is that H3 clips read like the Krea2/Z-Image stills, not like a
    // different product. `appendFilmGrain` rewrites a node's `images` input, and
    // `CreateVideo` has one, so the image-side helper works here unchanged.
    //
    // Deliberately AFTER the RIFE splice: graining first would hand RIFE noisy
    // frames to interpolate, smearing the grain into ghost trails instead of
    // giving each frame its own. The node re-rolls its noise per frame (it loops
    // the batch), so there is no fixed-pattern "dirty lens" look.
    // Default ON — hence `!== false`, not a truthiness check. Flow models render
    // airbrushed skin and this is the cheap corrective, so it is opt-OUT here
    // the way the LTX motion LoRA is.
    if (params.filmGrain !== false) {
      appendFilmGrain(wf as unknown as ComfyUIPrompt, VIDEO_ID, { intensity: H3_GRAIN_INTENSITY })
    }

    if (hunting) {
      // Candidates must NOT reach the gallery — they are throwaway. Core's
      // `SaveVideo` has no save_output switch and always writes to output, so
      // the candidate goes out through VHS_VideoCombine with `save_output:
      // false` instead, landing in ComfyUI's temp dir. That is also exactly the
      // shape the frontend already understands: `resolveInterimVideo` looks for
      // a temp clip under `gifs`, which is what this node reports, so the whole
      // seed-hunt UI works here with no changes. Read after the RIFE splice so
      // the images ref and fps are whatever the graph finally settled on.
      const combine = freshId()
      wf[combine] = {
        class_type: 'VHS_VideoCombine',
        _meta: { title: 'Seed-hunt candidate (temp)' },
        inputs: {
          images: wf[VIDEO_ID].inputs.images,
          audio: [AUDIO_ID, 0],
          frame_rate: wf[VIDEO_ID].inputs.fps,
          loop_count: 0,
          filename_prefix: 'MinimaxH3_hunt',
          format: 'video/h264-mp4',
          pingpong: false,
          save_output: false,
        },
      }
      delete wf[VIDEO_ID]
      delete wf[SAVE_ID]
    }

    return wf as ComfyUIPrompt
  },
}
