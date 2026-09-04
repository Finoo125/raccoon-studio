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
const SAMPLER_ID = idOf('KSamplerSelect')
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

/** Which distillation a render is using, if any. See `H3_TURBO`. */
export type H3TurboTier = 'draft' | 'fast'

/**
 * The two Turbo tiers, each a whole profile — LoRA, step count, strength and
 * sigma shift travel together, because a distilled LoRA is only correct at the
 * schedule it was distilled for.
 *
 * `draft` — drbaph's conversion of larryvrh's 4-step preview weights, run at 6
 * steps. Positioned as *testing*, not quality: you use it to find a prompt and
 * a seed, then render the keeper without it. Its authors flag plastic skin and
 * over-sharp grain, hence strength 0.9 rather than the 1.0 it trained at —
 * strength is their own dial for that trade (1.05–1.2 against blur, 0.8–0.95
 * against grain). drbaph's build, never larryvrh's original: the original needs
 * the `ComfyUI-MiniMax-H3-Turbo` node pack to load on a pruned checkpoint.
 *
 * `fast` — lightx2v/ModelTC's 8-step v1.0, good enough for clips you keep. It
 * loads through core `LoraLoaderModelOnly` on the pruned int8 checkpoint with
 * no node pack at all (dynamic-rank, never pruned-converted), which is why it
 * can sit beside `draft` without costing this graph its core-only property.
 * 0.75 strength and shift 12/3 are the author's figures; the `audio: 3` is the
 * node's own default and is **not** a transcription slip of draft's 6 — that 6
 * comes from the drbaph/larryvrh reference workflow and belongs only to it.
 *
 * Both are optional downloads and each tier is offered only once its file is on
 * disk, so a profile here can never name a weight the render cannot load.
 */
export const H3_TURBO: Record<
  H3TurboTier,
  { lora: string; steps: number; strength: number; shift: { video: number; audio: number } }
> = {
  draft: {
    lora: 'minimax_h3_turbo_4step_ckpt500_pruned_comfyui.safetensors',
    steps: 6,
    strength: 0.9,
    shift: { video: 12, audio: 6 },
  },
  fast: {
    // drbaph's rank-21 resize of lightx2v's 8-step v1.0 — 327 MB rather than
    // 1.96 GB, measured equivalent over 3 seeds (see minimax-h3-assets.ts for
    // the numbers and the `.alpha` caveat that goes with re-tuning `strength`).
    lora: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_resized_avg_rank_21_bf16.safetensors',
    steps: 8,
    strength: 0.75,
    shift: { video: 12, audio: 3 },
  },
}

/**
 * ref2va's own distillation. Both tiers swap to it in reference mode, because
 * the fl2v LoRAs above are the wrong shape for the reference checkpoint's
 * conditioning — it is a different model, not a mode.
 *
 * Only lightx2v ships one and only at 4 steps / v0.1, so Fast in reference mode
 * is the same weights as Draft, just given 8 steps instead of 6. Over-stepping
 * a 4-step distillation is safe; it buys less than the fl2v 8-step build does.
 * Gated on `params.ref2vTurbo`, so an install this file is missing from simply
 * keeps the fl2v LoRA rather than failing ComfyUI validation.
 */
export const H3_REF2V_TURBO_LORA = 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors'

/**
 * Normalise the param to a tier. `true` is the pre-two-tier spelling of
 * `'draft'` and has to keep working: it is persisted in users' form state and
 * baked into saved Director runs.
 */
export const h3TurboTier = (v: VideoGenerationParams['turbo']): H3TurboTier | null =>
  v === true || v === 'draft' ? 'draft' : v === 'fast' ? 'fast' : null

/** Back-compat alias: the Draft LoRA, which was the only one for a while. */
export const H3_TURBO_LORA = H3_TURBO.draft.lora

/**
 * ref2va weights — a **separate 21 GB checkpoint**, not a flag on the fl2va one.
 * Same quantisation choice as the model we already ship: pruned int8 convrot,
 * deliberately not `pruned_fp8_scaled` (ten megabytes away in the HF listing,
 * and fp8_scaled is the format DynamicVRAM renders as tiled garbage).
 */
export const H3_REF2VA_CKPT = 'minimax_h3_ref2va_pruned_int8_convrot.safetensors'

/**
 * TenStrip's 10Eros Max (beta4) — an alternative fl2va checkpoint, offered
 * beside the stock one in the video form.
 *
 * A whole profile like `H3_TURBO`, for the same reason: this build is a
 * **TURBO-hybrid**, meaning the author merged his own distillation into the
 * weights. So it does not merely swap `unet_name` — it also owns the sampler,
 * the scheduler and the step count, and a Turbo LoRA must **not** be stacked on
 * top of it (a LoRA distilled for one schedule patching a model already merged
 * onto another is how you get the soft, over-sharpened clip the card's beta3
 * notes complain about). The whole documented recipe is one line: *"For beta_4
 * use euler/simple 6-8 steps on all modes."*
 *
 * `steps` takes the top of that range and `huntSteps` the bottom, which is what
 * keeps the seed hunt honestly cheaper here — there is no Draft tier to drop to,
 * so without this candidates would cost a full render each.
 *
 * Not applied in `ref2v`: that mode loads a structurally different checkpoint,
 * and TenStrip's reference build (`10Eros_Max_h3_TURBO_ref2va_beta2`) exists
 * only as a 40 GB bf16 file with no int8 convrot sibling. `h3UsesEros` is the
 * single reader of that exclusion.
 */
export const H3_EROS = {
  ckpt: '10Eros_Max_h3_TURBO-hybrid_beta4_int8_convrot.safetensors',
  sampler: 'euler',
  scheduler: 'simple',
  steps: 8,
  huntSteps: 6,
} as const

/**
 * Is this render on the Eros checkpoint?
 *
 * Never compare `h3Checkpoint` directly. The flag is persisted with the rest of
 * the form, so it survives a switch into reference mode — where these weights
 * are the wrong architecture entirely and ComfyUI would reject the graph.
 */
export const h3UsesEros = (p?: {
  h3Checkpoint?: VideoGenerationParams['h3Checkpoint']
  mode?: VideoGenerationParams['mode']
}): boolean => p?.h3Checkpoint === 'eros' && p.mode !== 'ref2v'

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
 * Steps for an undistilled render, plus back-compat aliases onto the Draft
 * profile. `H3_TURBO[tier]` is the live source for everything per-tier; these
 * exist so callers that predate the second tier keep resolving.
 */
export const H3_STEPS = { normal: 20, turbo: H3_TURBO.draft.steps } as const
export const H3_TURBO_STRENGTH = H3_TURBO.draft.strength

/**
 * Frames of the previous clip pinned at the head of a continuation.
 *
 * **Must stay on H3's 17k+5 clip grid** (5, 22, 39, 56): `MiniMaxH3AddGuide`
 * silently walks a non-grid batch *down* to the next legal length rather than
 * refusing, so an innocent-looking 24 would quietly pin 22 and the arithmetic
 * that trims the head back off would be wrong by two frames.
 *
 * 22 because one frame is not enough to say where anything is *going* — from a
 * single still the model cannot tell a rising ball from a falling one, so it
 * invents the motion and the join visibly changes direction. 22 frames (~0.9 s)
 * carry velocity. The pack that tuned this calls 5 "just barely fluid" and 22
 * "nearly seamless", and warns that 56 spends 2.3 s of every render on frames
 * you throw away.
 */
export const H3_CONTEXT_FRAMES = 22

/**
 * Seconds delivered by a continuation that was *sampled* for `durationSeconds`.
 *
 * The pinned head comes back at the start of the new clip and is trimmed before
 * saving, so a continuation always delivers less than it rendered. Anything
 * showing the user a running total has to use this, not the slider value.
 */
export const h3DeliveredSeconds = (durationSeconds: number): number =>
  (h3FrameCount(h3ClampDuration(durationSeconds)) - H3_CONTEXT_FRAMES) / H3_FPS

/**
 * fal's realism-people adapter — the fix for H3's waxy, airbrushed skin, which
 * film grain until now only masked. Optional 125 MB download, off by default.
 *
 * Loads through core `LoraLoaderModelOnly` (standard H3 key layout, rank 32),
 * so it costs this graph nothing.
 */
export const H3_REALISM_LORA = 'h3-realism-people-t2v-i2v-r2v.safetensors'

/**
 * 0.7, not the author's headline 1.0 — measured here 2026-08-16 at 20 steps over
 * two seeds, then re-measured stacked on the Fast Turbo LoRA.
 *
 * At 1.0 the adapter reliably drags the shot to an *extreme* close-up with a
 * blown-out background, tighter than the prompt asked for, which fights the
 * timed multi-shot doctrine that decides framing. At 0.7 the skin win survives
 * intact — pores, capillaries, individual stubble — and the framing and
 * background come back. fal's README offers 0.6-0.8 as the lighter touch, so
 * this sits inside their own range rather than off it.
 */
export const H3_REALISM_STRENGTH = 0.7

/**
 * The adapter's trigger word, which fal requires at the START of the prompt.
 *
 * Our prompts are written by the doctrine, not typed, so the builder injects it
 * rather than asking the user to remember a magic token — forgetting it is a
 * silent no-op that reads as "the LoRA does nothing".
 */
export const H3_REALISM_TRIGGER = 'r34l1sm'

/** Where the H3 field block starts; the trigger goes immediately above it. */
const IMD_FIELD = 'integrated_multimodal_description:'

/**
 * Put the trigger word in front of the field block, not in front of the prompt.
 *
 * The very first line of an i2v/fl2v/l2v/ref2v prompt is a load-bearing
 * alignment instruction that H3's guide requires to come first, so prepending
 * ahead of everything would displace it. Sitting just above the fields matches
 * the shape this was actually measured with. A freeform prompt with no field
 * block simply gets it at the top, which is fal's own instruction.
 */
export function withRealismTrigger(prompt: string): string {
  const p = prompt ?? ''
  // Already present (a user typed it, or a saved prompt is being re-rendered).
  if (new RegExp(`(^|\\s)${H3_REALISM_TRIGGER}(\\s|$)`).test(p)) return p
  const at = p.indexOf(IMD_FIELD)
  if (at === -1) return `${H3_REALISM_TRIGGER}\n\n${p}`
  return `${p.slice(0, at)}${H3_REALISM_TRIGGER}\n\n${p.slice(at)}`
}

/**
 * Film-grain intensity for video. Started above the stills' 0.04 on the theory
 * that motion hides fine texture; on real clips it just read heavy, so it is
 * back to the same number the stills use. Anything near 0.1 visibly desaturates
 * the frame, so tune downward from here, not up.
 */
export const H3_GRAIN_INTENSITY = 0.04

/**
 * RCAS sharpen strength — AMD's contrast-adaptive filter from FSR, via KJNodes'
 * `ImageSharpenKJ`. A single 5-tap cross filter that adapts to local contrast,
 * so it has far fewer halo artefacts than an unsharp mask at the same bite.
 *
 * 0.3 is PlagueKind's V7 figure ("looks natural"); the node's own default is
 * 0.8, which on H3's already-soft output reads as over-sharpened rather than
 * detailed. Tune downward from here.
 *
 * A different job from both grain and the realism adapter: grain lays texture
 * over the frame, the adapter rebuilds skin, this raises local contrast on the
 * detail that is already there. It cannot invent detail the sampler dropped —
 * for that, more steps.
 */
export const H3_SHARPEN_STRENGTH = 0.3

/** Frames per second RIFE interpolates up to. Exactly 2x H3's fixed 24. */
export const H3_RIFE_FPS = 48

/**
 * H3 renders at 24 fps and nothing else: the model's flow schedule and its
 * 17k+5 frame grid are both defined against 24. `params.fps` is therefore
 * ignored by this builder rather than passed through — a 30 fps request would
 * silently change the clip's duration, not its smoothness.
 */
export const H3_FPS = 24

/**
 * Seconds of the previous clip's sound pinned alongside those frames.
 *
 * **Derived from `H3_CONTEXT_FRAMES`, never chosen independently.**
 * `MiniMaxH3AddGuide` anchors audio *forward* from `frame_idx`, so a window of
 * a different length than the picture pin desynchronises the two: at 1.0 s
 * (24 frames) against a 22-frame picture pin, new-frame 0 showed the previous
 * clip's frame N-22 while playing its audio from N-24 — 83 ms of A/V drift
 * inside the pinned head — and the extra 2 frames of sound survived the
 * 22-frame trim, so every delivered clip opened with a fragment of the
 * previous one's audio. Both streams must cover the same span and end at the
 * same instant, which is the cut point.
 *
 * The cost of tying them: 22 frames is not a multiple of 3, so the window no
 * longer lands exactly on H3's 40 Hz audio grid (a frame is 5/3 audio steps).
 * Alignment with the picture is worth more than grid-exactness — a sub-step
 * rounding is smaller than the 83 ms it replaces.
 */
export const H3_CONTEXT_AUDIO_S = H3_CONTEXT_FRAMES / H3_FPS

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
 * H3's trained clip length, in seconds at 24 fps.
 *
 * The model was trained on 124–362 frames, and `h3FrameCount` lands exactly on
 * both ends (5 s → 124, 15 s → 362) because the bounds are themselves points on
 * the 17k+5 grid. Past 362 the model does not refuse, it degrades — so the form
 * happily offered 30 s (727 frames, twice the ceiling) and the render came back
 * worse for having taken twice as long.
 *
 * `h3_brain.py` has carried `MAX_DURATION_S = 15` since it was written, with a
 * comment that the slider goes to 30 and "the model simply will not honour
 * that" — but it clamps only the words it writes, never the frame count the
 * graph asks for. This is the other half of that clamp.
 */
export const H3_MIN_DURATION_S = 5
export const H3_MAX_DURATION_S = 15

/** `d` clamped to the range H3 was trained on. */
export const h3ClampDuration = (d: number): number =>
  Math.min(H3_MAX_DURATION_S, Math.max(H3_MIN_DURATION_S, d))

/**
 * Frame count for a duration, snapped up to H3's 17k+5 grid at 24 fps.
 *
 * This is the `ComfyMathExpression` from the official templates
 * (`max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17`) done in
 * TypeScript instead — which drops both that node and `PrimitiveFloat` from the
 * graph, and with them the only dependency this workflow would have had on a
 * custom node pack. 5 s → 124 frames, matching the documented figure.
 *
 * Grid arithmetic only, deliberately unclamped: callers pass it through
 * `h3ClampDuration` first, and `buildPrompt` does.
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
 * Which of MiniMax's documented tasks a set of params actually describes.
 *
 * H3's base checkpoint is FL2VA — first-*and-last*-frame — and its conditioning
 * node takes `first_frame` and `last_frame` as two independent optional inputs
 * (`nodes_minimax_h3.py`). So the task is a function of which image slots are
 * filled, not of a separate mode the user picks:
 *
 *   first only  -> i2v   animate forward from the frame
 *   both        -> fl2v  travel from one frame to the other
 *   last only   -> l2v   converge onto a known final frame
 *   neither     -> t2v   (what `mode: 'i2v'` with no image already did)
 *
 * The prompt doctrine needs the same answer — each task has its own mandatory
 * instruction line in MiniMax's guide — so this is exported and the form sends
 * its result to the enhancer. One reader, one table.
 */
export type H3Task = 't2v' | 'i2v' | 'fl2v' | 'l2v' | 'ref2v'

export function h3Task(
  p: Pick<VideoGenerationParams, 'mode' | 'inputImage' | 'endImage'>,
): H3Task {
  if (p.mode === 'ref2v') return 'ref2v'
  if (p.mode !== 'i2v') return 't2v'
  if (p.inputImage) return p.endImage ? 'fl2v' : 'i2v'
  return p.endImage ? 'l2v' : 't2v'
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
  tier: H3TurboTier | null,
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
  // way LTX layers the stack over its built-in distillation LoRA. In reference
  // mode it is ref2va's own distillation instead — but only once the form has
  // confirmed that file is on disk, or a render that could have degraded to the
  // fl2v LoRA would 400 at ComfyUI's validation step.
  if (tier) {
    const useRef2v = params.mode === 'ref2v' && params.ref2vTurbo === true
    lora(useRef2v ? H3_REF2V_TURBO_LORA : H3_TURBO[tier].lora, H3_TURBO[tier].strength)
  }
  for (const l of userLoras(params)) lora(l.name, l.strength)

  // Realism last of the weight patches, so a user LoRA in a slot still stacks
  // over it the way it stacks over Turbo. Gated on the form having confirmed the
  // file is on disk — same contract as the Turbo tiers, because naming a missing
  // LoRA fails ComfyUI's validation for the whole prompt rather than degrading.
  if (params.realismLora === true) lora(H3_REALISM_LORA, H3_REALISM_STRENGTH)

  if (tier) {
    link({
      class_type: 'MiniMaxH3SigmaShift',
      _meta: { title: 'MiniMax H3 Sigma Shift' },
      inputs: {
        model: [head, 0],
        shift_video: H3_TURBO[tier].shift.video,
        shift_audio: H3_TURBO[tier].shift.audio,
      },
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

    // A continuation opens on its pinned head, so a start or end frame would
    // fight it — nothing can honour two different things at frame 0. Cleared
    // here rather than trusted to the caller, so every downstream read (task
    // derivation, the aspect anchor, the loader splice) sees one truth.
    if (params.continueFrom) params = { ...params, inputImage: undefined, endImage: undefined }

    cond.prompt =
      params.realismLora === true ? withRealismTrigger(params.prompt) : params.prompt
    cond.length = h3FrameCount(h3ClampDuration(params.durationSeconds))
    wf[VIDEO_ID].inputs.fps = H3_FPS

    const tier = tierOf(params.vramMode)
    const budget = BUDGET_MP[tier]

    const task = h3Task(params)

    if (params.inputImage && (task === 'i2v' || task === 'fl2v')) {
      wf[IMAGE_ID].inputs.image = params.inputImage
    } else {
      // t2v, ref2v and l2v: `first_frame` is optional on the node, so dropping
      // the loader and the link is all it takes — there is no black-frame
      // placeholder to feed it, and passing one would tell the model to open on
      // black.
      spliceOut(wf, IMAGE_ID)
    }

    // The end frame is a second `LoadImage` on the node's other optional input.
    // Allocated here rather than in the base JSON so a plain i2v/t2v graph is
    // byte-identical to what it was before this existed — a graph that gained a
    // dangling node would miss ComfyUI's execution cache on every old render.
    if (params.endImage && (task === 'fl2v' || task === 'l2v')) {
      const id = freshId()
      wf[id] = {
        class_type: 'LoadImage',
        _meta: { title: 'End frame' },
        inputs: { image: params.endImage },
      }
      cond.last_frame = [id, 0]
    }

    // Fit the render to whichever anchor frame exists so it is not distorted —
    // the start frame wins when both are given, since a mismatched pair has to
    // resolve to one shape and the opening is what the viewer sees first.
    // Without recorded dims (or any anchor at all) fall back to the picker:
    // ref2v has no source aspect either, its references never appear as a frame.
    const anchor =
      params.inputImage && params.inputImageWidth && params.inputImageHeight
        ? params.inputImageWidth / params.inputImageHeight
        : params.endImage && params.endImageWidth && params.endImageHeight
          ? params.endImageWidth / params.endImageHeight
          : null
    const d = h3Dims(
      anchor ?? (ORIENTATIONS.find((o) => o.value === params.orientation) ?? ORIENTATIONS[1]).aspect,
      budget,
    )
    cond.width = d.w
    cond.height = d.h

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
    // The Eros finetune carries its own distillation in the weights, so it
    // retires the Turbo dial rather than stacking on it, and brings its own
    // sampler/scheduler/steps (see `H3_EROS`). `speed` is forced to null so
    // `buildModelChain` adds neither the Turbo LoRA nor the sigma shift.
    const eros = h3UsesEros(params)
    // Hunting upgrades "no Turbo" to Draft — the cheapest tier, since the point
    // is throwaway candidates — but honours an explicit Fast pick rather than
    // quietly downgrading someone who chose it.
    const speed = eros ? null : (h3TurboTier(params.turbo) ?? (hunting ? 'draft' : null))
    if (eros) {
      wf[MODEL_ID].inputs.unet_name = H3_EROS.ckpt
      wf[SAMPLER_ID].inputs.sampler_name = H3_EROS.sampler
      wf[SCHED_ID].inputs.scheduler = H3_EROS.scheduler
    }
    // Candidates take the low end of the card's 6-8 range: with no Draft tier to
    // fall back on, that step cut is the entire seed-hunt discount.
    wf[SCHED_ID].inputs.steps = eros
      ? hunting
        ? H3_EROS.huntSteps
        : H3_EROS.steps
      : speed
        ? H3_TURBO[speed].steps
        : H3_STEPS.normal
    const model = buildModelChain(wf, params, speed, freshId)
    if (model !== MODEL_ID) {
      wf[SCHED_ID].inputs.model = [model, 0]
      wf[GUIDER_ID].inputs.model = [model, 0]
    }

    // ── Continuation: pin the previous clip's tail, then trim it back off ────
    //
    // Five core nodes, so this costs the graph none of its core-only property:
    //   LoadVideo -> GetVideoComponents -> ImageFromBatch / TrimAudioDuration
    //   -> MiniMaxH3AddGuide (which only rewrites the conditioning)
    //
    // Placed before the RIFE splice on purpose: trimming first means RIFE
    // interpolates 22 fewer frames, and the frame index stays in *source*
    // frames rather than doubling with the output fps.
    if (params.continueFrom) {
      const load = freshId()
      wf[load] = {
        class_type: 'LoadVideo',
        _meta: { title: 'Previous clip' },
        // ` [output]` makes core LoadVideo read from output/ rather than its
        // own input/ listing — `folder_paths.annotated_filepath` honours it and
        // ComfyUI does not reject the value for being absent from the node's
        // combo options. Verified live, both validation and execution, so the
        // previous clip never has to be copied or re-uploaded per link.
        inputs: { file: `${params.continueFrom} [output]` },
      }
      const split = freshId()
      wf[split] = {
        class_type: 'GetVideoComponents',
        _meta: { title: 'Previous clip frames + sound' },
        inputs: { video: [load, 0] },
      }
      /**
       * Size the render from the previous clip instead of from the form.
       *
       * The form's orientation and pixel budget describe whatever the user last
       * picked, which has nothing to do with the clip being continued. A
       * portrait 672×960 source continued while the form said landscape came
       * back 1088×608: `AddGuide` **resizes the guide to the target rather than
       * refusing**, so it centre-cropped a thin band out of the portrait frames
       * and upscaled it — wrong framing and a large quality loss, with no error
       * anywhere. Reported from a real render.
       *
       * Carrying width/height through params instead would work until they
       * drifted; taking them off the source's own frames cannot disagree with
       * it. `GetImageSize` is core, and H3 only ever emits legal sizes (they
       * came out of `h3Dims`), so nothing needs re-snapping. It also means the
       * pinned frames are used at their native size, with no resample at all.
       */
      const size = freshId()
      wf[size] = {
        class_type: 'GetImageSize',
        _meta: { title: 'Match the previous clip’s size' },
        inputs: { image: [split, 0] },
      }
      cond.width = [size, 0]
      cond.height = [size, 1]

      const tailFrames = freshId()
      wf[tailFrames] = {
        class_type: 'ImageFromBatch',
        _meta: { title: `Last ${H3_CONTEXT_FRAMES} frames` },
        // Negative index counts from the end (`batch_index += shape[0]` in the
        // node), which is what makes this the *tail* rather than the opening.
        inputs: {
          image: [split, 0],
          batch_index: -H3_CONTEXT_FRAMES,
          length: H3_CONTEXT_FRAMES,
        },
      }
      const tailAudio = freshId()
      wf[tailAudio] = {
        class_type: 'TrimAudioDuration',
        _meta: { title: 'Tail sound' },
        inputs: {
          audio: [split, 1],
          start_index: -H3_CONTEXT_AUDIO_S,
          duration: H3_CONTEXT_AUDIO_S,
        },
      }
      const guide = freshId()
      wf[guide] = {
        class_type: 'MiniMaxH3AddGuide',
        _meta: { title: 'Pin previous tail at frame 0' },
        inputs: {
          positive: [COND_ID, 0],
          latent: [COND_ID, 1],
          // Both VAEs by role, never by id: this graph has two VAELoaders and
          // which is which is decided by what the decoders already read. The
          // ref2v branch identifies the audio one the same way.
          vae: wf[DECODE_ID].inputs.vae,
          audio_vae: wf[AUDIO_ID].inputs.vae,
          image: [tailFrames, 0],
          audio: [tailAudio, 0],
          frame_idx: 0,
        },
      }
      // AddGuide returns conditioning only — the latent still comes straight
      // off the conditioning node.
      wf[GUIDER_ID].inputs.conditioning = [guide, 0]

      // The pinned frames come back at the head of the render and have to come
      // off before the clip is saved, picture and sound together, or every join
      // repeats a second of the previous clip.
      const deliveredS = (Number(cond.length) - H3_CONTEXT_FRAMES) / H3_FPS
      const cutFrames = freshId()
      wf[cutFrames] = {
        class_type: 'ImageFromBatch',
        _meta: { title: 'Drop pinned head' },
        inputs: {
          image: wf[VIDEO_ID].inputs.images,
          batch_index: H3_CONTEXT_FRAMES,
          // `length` is clamped to what is left, so this asks for "the rest".
          length: 4096,
        },
      }
      wf[VIDEO_ID].inputs.images = [cutFrames, 0]
      const cutAudio = freshId()
      wf[cutAudio] = {
        class_type: 'TrimAudioDuration',
        _meta: { title: 'Drop pinned head (sound)' },
        inputs: {
          audio: wf[VIDEO_ID].inputs.audio,
          start_index: H3_CONTEXT_FRAMES / H3_FPS,
          duration: deliveredS,
        },
      }
      wf[VIDEO_ID].inputs.audio = [cutAudio, 0]
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
          // Whatever is currently feeding the container, not DECODE_ID: a
          // continuation puts a trim in between, and reading past it would
          // interpolate the pinned head straight back into the delivered clip.
          images: wf[VIDEO_ID].inputs.images,
          source_fps: H3_FPS,
          target_fps: H3_RIFE_FPS,
          scale: 1,
        },
      }
      wf[VIDEO_ID].inputs.images = [rife, 0]
      wf[VIDEO_ID].inputs.fps = H3_RIFE_FPS
    }

    // RCAS sharpen — one cheap pass against H3's softness. See
    // H3_SHARPEN_STRENGTH for why 0.3 and not the node's own 0.8.
    //
    // Its place in the chain is between RIFE and grain, and both edges matter:
    // sharpening *before* RIFE would leave the interpolated frames unsharpened
    // while the real ones were, so crispness would alternate frame to frame;
    // sharpening *after* grain would sharpen the grain into crunch instead of
    // sharpening the picture.
    if (params.sharpen === true) {
      const sharp = freshId()
      wf[sharp] = {
        class_type: 'ImageSharpenKJ',
        _meta: { title: 'RCAS sharpen' },
        inputs: {
          // Read off the container, not the decoder: a continuation trims the
          // pinned head out in between, and reading past that would sharpen —
          // and re-attach — frames this clip is supposed to drop.
          image: wf[VIDEO_ID].inputs.images,
          // `method` is a V3 dynamic combo: the key selects the option, and that
          // option's own inputs arrive prefixed with the parent id
          // (`comfy_api/latest/_io.py:1599`) — the same convention as ref2v's
          // autogrow slots. Get the prefix wrong and `method` stays a bare
          // string, which the node subscripts and dies on, so this fails loudly
          // rather than silently rendering unsharpened.
          method: 'rcas',
          'method.strength': H3_SHARPEN_STRENGTH,
        },
      }
      wf[VIDEO_ID].inputs.images = [sharp, 0]
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
          // Read off the container like `images` above, not straight from the
          // decoder: a continuation trims the pinned head out of both streams,
          // and taking audio from the decoder would put that second of sound
          // back while the picture stayed trimmed.
          audio: wf[VIDEO_ID].inputs.audio,
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
