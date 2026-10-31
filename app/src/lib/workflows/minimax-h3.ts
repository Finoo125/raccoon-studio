import type { ComfyUIPrompt, ComfyUIPromptNode } from '@/types/comfyui'
import type { VideoWorkflowDefinition, VideoGenerationParams, H3KeyframeSlot } from '@/types/video-workflow'
import baseWorkflow from '../../../workflows/MinimaxH3.json'
import { appendFilmGrain } from './film-grain'
import { EDIT_JOIN_OVERLAP, planEditChunks, type EditChunk } from './h3-edit-chunks'
import { appendVideoFaceSwap } from './video-face-swap'

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
 * the fl2v LoRAs above were distilled on the fl2va weights — *not* because they
 * are the wrong shape, which they are not: both LoRAs carry the same 624 keys
 * at the same shapes, since every H3 task checkpoint is one architecture.
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
 * TenStrip's 10Eros Max (beta6 since 2026-10-14; beta5 from 2026-09-13, beta4
 * before) — an alternative fl2va checkpoint, offered beside the stock one in
 * the video form.
 *
 * **beta6 replaced beta5 on 2026-10-14**, the owner's pick after a 3-way test
 * (beta5 / beta6 / Hybrid, three NSFW clips × i2v and reference mode, same
 * seeds, prompts and pictures): beta6 rendered brighter (mean luma 123 vs
 * 109) and sharper (Laplacian p99 78 vs 64) at the same speed (155 vs 151 s a
 * clip), kept outfit detail best, ArcFace vs her face within noise (0.638 vs
 * 0.650). Its card samples it at **shift 10/3** and 8-12 steps ("a
 * mostly-reference hybrid with a custom turbo meant to mimic how Fastv2 looks
 * and sounds"), so unlike beta5 it carries a `shift` here and gets a
 * `MiniMaxH3SigmaShift` node; euler/simple 8 stays (what the test measured).
 * The notes below are beta4/beta5 history and still explain the profile.
 *
 * A whole profile like `H3_TURBO`, for the same reason: this build is a
 * **TURBO-hybrid**, meaning the author merged his own distillation into the
 * weights. So it does not merely swap `unet_name` — it also owns the sampler,
 * the scheduler and the step count, and a Turbo LoRA must **not** be stacked on
 * top of it (a LoRA distilled for one schedule patching a model already merged
 * onto another is how you get the soft, over-sharpened clip the card's beta3
 * notes complain about). beta4's documented recipe was one line — *"use
 * euler/simple 6-8 steps on all modes"* — and beta5's card lists euler/simple
 * 4-8 among several (er_sde/beta57 4-6, res_multistep/simple 6-8 as the author's
 * "go-to for best motion quality", LCM/simple 6-8 for "best turbo audio").
 * **euler/simple stays**, measured 2026-09-13 on beta5 over five clips at
 * identical seeds: res_multistep was +2 Laplacian p99 sharper while euler held
 * face consistency +0.01 higher and audio SNR +1.5 dB — a wash inside
 * one-seed noise, and a sampler change invalidates every saved Eros seed, the
 * same bar the launch flags have to clear. beta5's shift was the model's
 * built-in 12 video / 3 audio (`supported_models.py`), the author's figure for
 * that build, so it needed no `MiniMaxH3SigmaShift` node; beta6's card says
 * 10/3 (see `shift`).
 *
 * `steps` and `huntSteps` keep the seed hunt honestly cheaper — there is no
 * Draft tier to drop to, so without this candidates would cost a full render
 * each. ponytail: beta6's card range starts at 8, so a 6-step candidate is
 * below it and unmeasured; a candidate only has to show the seed's
 * composition. Raise `huntSteps` if candidates come back broken.
 *
 * **It serves reference mode too** — this comment used to deny that, on the
 * assumption that ref2v needs structurally different weights. Measured off the
 * safetensors headers 2026-09-06, it does not: stock fl2va and ref2va carry 932
 * identically-named, identically-shaped tensors (reference conditioning rides
 * the conditioning stream, not extra layers), and **211 of beta4's 220
 * unquantized tensors are bit-identical to ref2va while none match fl2va**, its
 * 50 DiT blocks sitting ~46% of the way along the fl2va→ref2va axis. So
 * "TURBO-hybrid" is literal twice over — the turbo is merged in, and so are the
 * two task checkpoints ("built on the delta1024 h3 merge"). The card says the
 * same: *"use euler/simple 6-8 steps on all modes"*, and beta3's turbo "harms
 * referenced starts in i2v and reference mode… fixed in v4". `TURBO_ref2va_beta2`
 * (40 GB bf16, no int8 sibling) is that older pre-hybrid line, not a file this
 * needs.
 */
export const H3_EROS = {
  ckpt: '10Eros_Max_h3_8stepTURBO_beta6_int8.safetensors',
  sampler: 'euler',
  scheduler: 'simple',
  steps: 8,
  huntSteps: 6,
  shift: { video: 10, audio: 3 },
} as const

/**
 * Is this render on the Eros checkpoint? Every mode, reference included.
 *
 * Still the one reader of the flag — the builder, the cost model and the A/B
 * harness all ask here rather than comparing `h3Checkpoint` themselves, so a
 * future exclusion has exactly one place to live.
 */
export const h3UsesEros = (p?: {
  h3Checkpoint?: VideoGenerationParams['h3Checkpoint']
}): boolean => p?.h3Checkpoint === 'eros'

/**
 * Plaguekind's MiniMax H3 V11 recipe (2026-09-21), offered as a third
 * checkpoint: smhfacct's fl2va+ref2va hybrid (ref2va's blocks 25-49 in fl2va),
 * res_multistep / simple, 13 steps, cfg 1, no Turbo and no sigma shift — he
 * dropped Turbo because "it was ruining video and audio". Measured 2026-10-02
 * against Eros 8 on six of the owner's jobs: steadier motion in 5/6, wider
 * stereo in 2/6 (Eros is near-mono), detail mixed, +33-42% render time. His
 * SLA attention and step cache are deliberately left out (rejected earlier).
 * One file for every mode, reference included — it is both checkpoints merged.
 */
export const H3_HYBRID = {
  ckpt: 'minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors',
  sampler: 'res_multistep',
  scheduler: 'simple',
  steps: 13,
  huntSteps: 8,
} as const

/**
 * Aki7777777's MiniMax H3_SparseRef15_Hybrid (Civitai, Pruned Partial-INT8 v1.0): fl2va with a sparse ref2va effect
 * through AdaLN on 15 of the 50 blocks, "strong resistance to character drift across long multi-clip generations".
 * Not distilled, so — unlike Eros — it brings a turbo LoRA: the author asks for fl2va LoRAs, and lightx2v's full
 * fl2v 8-step LoRA at 1.0 with euler/simple 8 and shift 12/3 is what the helper's 2026-10-16 checkpoint round measured
 * (face 0.76, the steadiest motion of four checkpoints, ~215 s per 10 s clip). Serves reference mode from its own file.
 */
export const H3_SPARSEREF = {
  ckpt: 'minimaxH3Sparseref15_prunedPartialINT8V10.safetensors',
  sampler: 'euler',
  scheduler: 'simple',
  steps: 8,
  huntSteps: 6,
  shift: { video: 12, audio: 3 },
  lora: { name: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors', strength: 1 },
} as const

/**
 * The profile of a checkpoint that owns its own schedule (no Speed row, no
 * Turbo tier — SparseRef15 names its own LoRA; a sigma shift only where the
 * profile names one, as beta6's card does), or null for the stock checkpoint. The one
 * reader for that question — the builder, the cost model and the form ask here.
 */
export const h3Profile = (p?: {
  h3Checkpoint?: VideoGenerationParams['h3Checkpoint']
}): typeof H3_EROS | typeof H3_HYBRID | typeof H3_SPARSEREF | null =>
  p?.h3Checkpoint === 'eros' ? H3_EROS
    : p?.h3Checkpoint === 'hybrid' ? H3_HYBRID
      : p?.h3Checkpoint === 'sparseref' ? H3_SPARSEREF
        : null

/**
 * Whether reference-conditioned modes (References, Edit) can render on the
 * picked checkpoint. Eros and the Hybrid carry ref2va's weights themselves, so
 * only the Standard pick needs the separate 21 GB ref2va file — gating every
 * pick on that file greyed out reference mode for anyone on Eros without it.
 */
export function h3RefCheckpointReady(
  checkpoint: VideoGenerationParams['h3Checkpoint'],
  ready: { ref2v: boolean; eros: boolean; hybrid: boolean; sparseref?: boolean },
): boolean {
  return checkpoint === 'eros' ? ready.eros
    : checkpoint === 'hybrid' ? ready.hybrid
      : checkpoint === 'sparseref' ? ready.sparseref === true
        : ready.ref2v
}

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

/**
 * What a reference picture is FOR, per slot. Ids must match `REF_IMAGE_ROLES`
 * in `h3_brain.py`, which maps each to the MiniMax marker it implies.
 *
 * Pictures only. `<Video>` and `<Audio>` already have a job the doctrine states
 * outright ("donates MOTION", "drives voice timbre"); a picture is the
 * ambiguous one, because a face, a room and a mood board all arrive as
 * `<Picture N>` and nothing but the order tells them apart.
 *
 * This exists because the prompt writer is BLIND for ref2v — `need_vision` in
 * `generation_core.py` leaves ref2v out unless `ref2v_vision` is set — so it
 * cannot look at a slot and see a face. Unset is a real choice and the default:
 * it reproduces the doctrine byte for byte as it shipped before roles, and a
 * guessed role is worse than none.
 */
export const H3_REF_ROLES = [
  { id: 'character', label: 'Character' },
  // A close-up of the character's own face, beside a sheet or full-body
  // picture. Measured 2026-10-11 (3 seeds): ArcFace against the character's
  // photo 0.315 -> 0.51.
  { id: 'face', label: 'Face close-up' },
  { id: 'location', label: 'Location' },
  { id: 'outfit', label: 'Outfit' },
  { id: 'prop', label: 'Prop' },
  { id: 'style', label: 'Style only' },
] as const

/**
 * The order H3 is shown the pictures in: character first, then what it wears,
 * then where it is, props, style, and unroled pictures last — ties keep the
 * user's slot order.
 *
 * Not cosmetic. Measured 2026-09-13 (same pictures, prompt and seed, one leg
 * each): with the character picture in slot 3, H3 kept that person's own
 * clothes and ignored the outfit picture; with it in slot 1, the outfit
 * transferred. H3 reads `<Picture 1>` as the subject, so the character has to
 * be presented first whatever slot the user happened to fill. This is the ONE
 * place that order is decided — the builder's `LoadImage`s, the roles the
 * writer numbers (`compactRefRoles`) and the slot labels (`refPictureNumber`)
 * all read it, so a `<Picture N>` in the prompt always names what the node
 * has in position N.
 */
const REF_ROLE_ORDER = ['character', 'face', 'outfit', 'location', 'prop', 'style']
export const orderedRefImages = (
  files?: (string | undefined)[],
  roles?: (string | undefined)[],
): { file: string; role: string | null; slot: number }[] =>
  (files ?? [])
    .flatMap((file, slot) => (file ? [{ file, role: (roles ?? [])[slot] ?? null, slot }] : []))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const rank = (role: string | null) => {
        const k = REF_ROLE_ORDER.indexOf(role ?? '')
        return k === -1 ? REF_ROLE_ORDER.length : k
      }
      return rank(a.r.role) - rank(b.r.role) || a.i - b.i
    })
    .map(({ r }) => r)

/** The `<Picture N>` the node will use for UI slot `slot`, or 0 if it is empty. */
export const refPictureNumber = (
  files: (string | undefined)[] | undefined,
  roles: (string | undefined)[] | undefined,
  slot: number,
): number => orderedRefImages(files, roles).findIndex((r) => r.slot === slot) + 1

/**
 * Roles in the order the node sees the pictures, so role N always describes
 * `<Picture N>`.
 *
 * Compacting the two lists independently is the bug this exists to prevent:
 * clearing image slot 1 promotes slot 2 to `<Picture 1>`, and a separately
 * compacted role list would hand `<Picture 1>` slot 1's role. Same for the
 * role ordering above: a writer told the character is `<Picture 3>` while the
 * node has it in position 1 would bind every tag to the wrong picture.
 */
export const compactRefRoles = (
  files?: (string | undefined)[],
  roles?: (string | undefined)[],
): (string | null)[] => orderedRefImages(files, roles).map((r) => r.role)

/**
 * Picture roles whose file must reach H3 without a face in it.
 *
 * Measured 2026-09-13, same seed throughout: an outfit picture that shows a
 * person wearing the outfit carries a second identity, and with two pictures
 * of that person against one of the character, H3 rendered THAT person — no
 * wording moved it (fully/partially_preserved, an explicit "the person in
 * <Picture 2> does not appear", all the same). The same pictures cropped below
 * the chin rendered the character wearing the outfit. So outfit and prop
 * pictures pass through `RaccoonHeadlessReference` (RaccoonSwapNodes), which
 * crops below the lowest detected chin and passes a face-free picture through
 * untouched. Character pictures obviously keep their face; a location or
 * style picture with someone in it is left alone too, because cropping a room
 * under a face would not leave a room.
 */
const FACELESS_REF_ROLES = new Set(['outfit', 'prop'])

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
 * Frames of the previous clip frozen at the head of a continuation, picture and
 * sound together (`RaccoonH3MaskedPrefix`).
 *
 * **Must sit on the 17k+5 frame grid AND on whole 40 Hz audio ticks** (a frame
 * is 5/3 ticks): 39 is the first length that does both, the next is 90. The
 * node refuses anything else rather than rounding, so the head trim can never
 * disagree with what was frozen.
 *
 * Until 2026-10-02 this was a 22-frame `MiniMaxH3AddGuide` keyframe, which H3
 * re-generates — and it re-generated the sound as "a separate clip that sounds
 * like this". Measured on Eros over 13 joins, freezing instead: delivered
 * picture step 1.14 vs 2.24 (median, 1 = no visible join), audio continuity
 * 0.95-0.98 vs 0.34-0.65, timbre jumps over 3 dB 0/13 vs 6/13, same render
 * time, no drift over 8 links (`h3-continuation-ab.live.test.ts`). The price is
 * the longer head: a 5 s render delivers 3.54 s instead of 4.25 s.
 */
export const H3_CONTEXT_FRAMES = 39

/**
 * Seconds delivered by a continuation that was *sampled* for `durationSeconds`.
 *
 * The pinned head comes back at the start of the new clip and is trimmed before
 * saving, so a continuation always delivers less than it rendered. Anything
 * showing the user a running total has to use this, not the slider value.
 */
export const h3DeliveredSeconds = (durationSeconds: number): number =>
  (h3FrameCount(h3ClampDuration(durationSeconds)) - H3_CONTEXT_FRAMES) / H3_FPS

export const H3_KEYFRAME_SLOTS = ['start', 'middle', 'end'] as const satisfies readonly H3KeyframeSlot[]

/**
 * Where each keyframe lands, in pixel frames of a `len`-frame render. A
 * continuation has no start — its frozen prefix is the opening — and its middle
 * is the middle of the NEW part. The one reader for the graph, the form's slot
 * labels and the writer's times.
 */
export function h3KeyframeFrames(len: number, continuing: boolean): Partial<Record<H3KeyframeSlot, number>> {
  if (continuing) return { middle: H3_CONTEXT_FRAMES + Math.floor((len - H3_CONTEXT_FRAMES) / 2), end: len - 1 }
  return { start: 0, middle: Math.floor(len / 2), end: len - 1 }
}

/**
 * A keyframe's time in the clip the user GETS. A continuation's frozen head is
 * trimmed off before saving, so its frames sit `H3_CONTEXT_FRAMES` earlier in
 * the delivered clip. For labels only — the writer works on the render timeline,
 * which is the one `durationS` describes.
 */
export const h3KeyframeClipSeconds = (frame: number, continuing: boolean): number =>
  (continuing ? frame - H3_CONTEXT_FRAMES : frame) / H3_FPS

/** The keyframes a render honours: filled slots, in time order. Empty outside ref2v. */
export function h3Keyframes(
  p: Pick<VideoGenerationParams, 'mode' | 'keyframes' | 'continueFrom'>,
  len: number,
): { slot: H3KeyframeSlot; image: string; frame: number }[] {
  if (p.mode !== 'ref2v' || !p.keyframes) return []
  const at = h3KeyframeFrames(len, Boolean(p.continueFrom))
  return H3_KEYFRAME_SLOTS.flatMap((slot) => {
    const image = p.keyframes?.[slot]?.image
    const frame = at[slot]
    return image && frame !== undefined ? [{ slot, image, frame }] : []
  })
}

/**
 * Edit mode's two LoRAs — Alissonerdx/Minimax-H3-ComfyUI (Apache-2.0). Trained on
 * stock ref2va with the whole source clip anchored by `MiniMaxH3AddGuide`;
 * measured 2026-10-02 on Eros too (9/9 edits did what was asked, the no-LoRA
 * controls returned the source unchanged). Every prompt must begin with the
 * trigger, so the builder prepends it rather than trusting the user to type it.
 */
export const H3_EDIT = {
  vfx: { lora: 'minimax_h3_vfx_edit_v1.0_r128.safetensors', trigger: 'vfx_edit:' },
  style: { lora: 'minimax_h3_style_transfer_v1.0_r64.safetensors', trigger: 'style_transfer:' },
  head: { lora: 'minimax_h3_head_swap_v1.0_r32.safetensors', trigger: 'head_swap:' },
} as const
/**
 * "First-frame propagate": the vfx edit LoRA continued on 124-frame clips with an
 * edited first frame in the reference channel (Alissonerdx, Apache-2.0). Used
 * instead of the standard one when the user brings an edited first frame.
 */
export const H3_EDIT_FFP_LORA = 'minimax_h3_vfx_edit_v1.0_r128_ffp.safetensors'
export type H3EditKind = keyof typeof H3_EDIT

/** 15 s on the grid — H3's trained ceiling, and the longest edit we render. */
export const H3_EDIT_MAX_FRAMES = 362

/**
 * Frames an edit renders: the source's own length snapped DOWN to 17k+5 (an
 * edit cannot invent footage past the clip's end), capped at 362. A clip over
 * 15.5 s returns null — refused, because quietly dropping its back half would
 * deliver a different clip than the one the user picked. Under 5 frames, null.
 */
export function h3EditFrames(sourceFrames: number): number | null {
  if (!Number.isFinite(sourceFrames) || sourceFrames < 5 || sourceFrames > 372) return null
  const n = Math.min(Math.floor(sourceFrames), H3_EDIT_MAX_FRAMES)
  return n - ((((n - 5) % 17) + 17) % 17)
}

/**
 * The parts an edit renders in (see h3-edit-chunks.ts) — one reader for the
 * builder, the form's "renders in N parts" line and the cost model, so the
 * three can never disagree. Sized from the same render dims the builder uses.
 * Null when this is not an edit, the clip has not been read yet, or it is over
 * 15 s.
 */
export function h3EditPlan(
  p: Pick<
    VideoGenerationParams,
    'mode' | 'editSourceFrames' | 'editSourceWidth' | 'editSourceHeight' | 'vramMode' | 'editJoin'
    | 'editKind' | 'editPictures' | 'editPictureRoles' | 'editFirstFrame' | 'editPictureNotes' | 'editFollow'
  >,
): EditChunk[] | null {
  if (p.mode !== 'edit' || !p.editSourceWidth || !p.editSourceHeight) return null
  const total = h3EditFrames(p.editSourceFrames ?? NaN)
  if (total === null) return null
  const d = h3Dims(p.editSourceWidth / p.editSourceHeight, BUDGET_MP[tierOf(p.vramMode)])
  return planEditChunks(
    total,
    (d.w / 32) * (d.h / 32),
    // Only part 1 sees the user's first frame; later parts get the previous
    // part's frame, which only a frozen-tail join keeps continuous.
    p.editJoin === 'fast' && !h3EditPictures(p).some((x) => x.firstFrame) ? 'fast' : 'seamless',
    h3EditPictures(p).length,
    p.editFollow === 'loose' ? 'loose' : 'exact',
  )
}

/** The edit kind that renders: Loosely is "Change something" only. */
export function h3EditKind(p: Pick<VideoGenerationParams, 'editKind' | 'editFollow'>): H3EditKind {
  return p.editFollow === 'loose' ? 'vfx' : (p.editKind ?? 'vfx')
}

/**
 * Per role: what the subject is, what it replaces, and the description line
 * that pins it to every frame. The "for the whole clip" / "every frame"
 * wording is load-bearing: measured 2026-10-03, a template that only said the
 * picture was "carried into the target video" held the new person for ~2 s and
 * then the reference video's original woman came back; the spike's prompt that
 * held all 8 s said it in the summary, the retention line and the description.
 */
interface LooseRole { what: string; replaces: string; detail: (n: number, desc: string, outfit: number) => string }
const LOOSE_ROLE: Record<string, LooseRole> = {
  character: {
    what: 'the person',
    replaces: 'the original person of <Video 1>',
    // With an outfit picture the person keeps face, hair and build and wears it.
    detail: (n, d, outfit) => outfit > 0
      ? `In place of the original person, <Subject ${n}> from <Picture ${n}>${d} performs every movement and pose of the original person with the same timing; their face, hair and build stay the same from the first frame to the last, and they wear the outfit from <Picture ${outfit}>.`
      : `In place of the original person, <Subject ${n}> from <Picture ${n}>${d} performs every movement and pose of the original person with the same timing; their face, hair, build and clothing stay the same from the first frame to the last.`,
  },
  outfit: {
    what: 'the outfit',
    replaces: 'the clothing in <Video 1>',
    detail: (n, d) => `<Subject ${n}>, the outfit from <Picture ${n}>${d}, is worn in place of the original clothing from the first frame to the last.`,
  },
  location: {
    what: 'the place',
    replaces: 'the background of <Video 1>',
    detail: (n, d) => `The background is <Subject ${n}>, the place from <Picture ${n}>${d}, in every frame.`,
  },
  prop: {
    what: 'the object',
    replaces: 'the matching object in <Video 1>',
    detail: (n, d) => `<Subject ${n}>, the object from <Picture ${n}>${d}, takes the place of the original object from the first frame to the last.`,
  },
  style: {
    what: 'the visual style',
    replaces: 'the look of <Video 1>',
    detail: (n, d) => `Every frame is rendered in the visual style of <Picture ${n}>${d}.`,
  },
}
const LOOSE_OTHER: LooseRole = {
  what: 'what is shown',
  replaces: 'the matching part of <Video 1>',
  detail: (n, d) => `<Subject ${n}> from <Picture ${n}>${d} appears from the first frame to the last.`,
}

/**
 * MiniMax's full-reference format (VIDEO_PROMPT_WRITING_GUIDE_ref_en.md) for an
 * edit whose clip rides the reference-video channel — the shape the 2026-10-03
 * spike wrote by hand, filled from the instruction, the picture roles and their
 * descriptions (the native route ignores a person picture without one).
 */
export function h3LooseEditPrompt(instruction: string, pictures: EditPicture[]): string {
  const roleOf = (pic: EditPicture) => LOOSE_ROLE[pic.role ?? ''] ?? LOOSE_OTHER
  const note = (pic: EditPicture) => pic.note?.replace(/\.$/, '')
  const paren = (pic: EditPicture) => (note(pic) ? ` (${note(pic)})` : '')
  const text = instruction.trim()
  // 1-based <Picture N> of an outfit picture, or 0.
  const outfit = pictures.findIndex((x) => x.role === 'outfit') + 1
  const appearance = (pic: EditPicture) =>
    pic.role === 'character' && outfit > 0 ? 'the face, hair and build of the person' : `the complete appearance of ${roleOf(pic).what}`
  return [
    'subject_definitions:',
    ...pictures.map((pic, i) => `<Subject ${i + 1}> is ${roleOf(pic).what} in <Picture ${i + 1}>${note(pic) ? `: ${note(pic)}` : ''}.`),
    '<Video 1> is the source video for the target video edit, providing the original motion, camera movement, framing, timing and temporal structure.',
    '',
    'summary:',
    [
      `[video editing${pictures.length ? ' + reference generation' : ''}] The target video is an edited version of <Video 1>. ${text}`,
      ...pictures.map((pic, i) => `<Subject ${i + 1}> replaces ${roleOf(pic).replaces} for the whole clip, with the same motion, poses and timing.`),
    ].join(' '),
    '',
    'retention_analysis:',
    ...pictures.map((pic, i) => `<Subject ${i + 1}> (appears throughout the target video): attribute_transfer - ${appearance(pic)} in <Picture ${i + 1}>${paren(pic)} replaces ${roleOf(pic).replaces} for the whole clip.`),
    '<Video 1> (entire target timeline): partially_preserved - the original timing, motion, pose, camera movement and framing are preserved; only what the instruction changes is different.',
    '',
    'detailed_description:',
    [
      `[Shot 1] At 00:00.000 The target video follows <Video 1> frame by frame with the same camera, framing, timing and motion. ${text}`,
      ...pictures.map((pic, i) => roleOf(pic).detail(i + 1, paren(pic), outfit)),
    ].join(' '),
    '',
    'overall_soundscape: the original ambience and sounds of <Video 1> continue unchanged.',
    '',
    'non_diegetic_music: N/A',
  ].join('\n')
}

/**
 * Pictures an edit takes at most. Phase 2 Task 2 measured 1, 2 and 3 at once
 * (see the ledger / docs/claude-context.md); set to 1 if more than one did not work.
 */
export const H3_EDIT_PICTURE_MAX = 3

export interface EditPicture {
  file: string
  role: string | null
  /** The edited first frame the FFP LoRA carries through the clip. */
  firstFrame?: true
  /** The picture's description (`editPictureNotes`), trimmed; absent if none. */
  note?: string
}

/**
 * The pictures an edit sends, in the order H3 numbers them: the same
 * character-first order reference mode uses (`orderedRefImages`), capped at
 * `H3_EDIT_PICTURE_MAX`. Reads `editPictures`, never `refImages`.
 */
export function h3EditPictures(
  p: Pick<VideoGenerationParams, 'mode' | 'editKind' | 'editPictures' | 'editPictureRoles' | 'editFirstFrame' | 'editPictureNotes' | 'editFollow'>,
): EditPicture[] {
  if (p.mode !== 'edit') return []
  // By SLOT, never by the index after sorting — the note belongs to its picture.
  const noteOf = (slot: number) => p.editPictureNotes?.[slot]?.trim() || undefined
  const withNote = (pic: EditPicture, slot: number): EditPicture => {
    const note = noteOf(slot)
    return note ? { ...pic, note } : pic
  }
  // The head swap LoRA takes exactly one face picture: the Person one, or the first.
  if (h3EditKind(p) === 'head') {
    const pics = orderedRefImages(p.editPictures, p.editPictureRoles)
    const face = pics.find((x) => x.role === 'character') ?? pics[0]
    return face ? [withNote({ file: face.file, role: 'character' }, face.slot)] : []
  }
  const roled: EditPicture[] = orderedRefImages(p.editPictures, p.editPictureRoles)
    .slice(0, H3_EDIT_PICTURE_MAX)
    .map(({ file, role, slot }) => withNote({ file, role }, slot))
  // The edited first frame is always <Picture 1> — the FFP LoRA's convention.
  const first: EditPicture[] = p.editFollow !== 'loose' && h3EditKind(p) === 'vfx' && p.editFirstFrame
    ? [{ file: p.editFirstFrame, role: null, firstFrame: true }]
    : []
  return [...first, ...roled]
}

/** What the builder adds per picture, so nobody has to type `<Picture N>`. */
const EDIT_ROLE_SENTENCE: Record<string, (n: number) => string> = {
  character: (n) => `The new person is the one shown in <Picture ${n}>.`,
  outfit: (n) => `The new outfit is the one shown in <Picture ${n}>.`,
  location: (n) => `The new surroundings are the ones shown in <Picture ${n}>.`,
  prop: (n) => `The new object is the one shown in <Picture ${n}>.`,
  style: (n) => `Use the visual style of <Picture ${n}>.`,
}

/** The conditioning prompt of an edit: trigger, the user's instruction, one sentence per picture. */
export function h3EditPrompt(p: VideoGenerationParams): string {
  if (p.editFollow === 'loose') return h3LooseEditPrompt(p.prompt, h3EditPictures(p))
  // A typed face description wins; an empty one falls back to the picture's.
  if (h3EditKind(p) === 'head') return h3HeadSwapPrompt(p.prompt.trim() || h3EditPictures(p)[0]?.note || '')
  const kind = h3EditKind(p)
  const pics = h3EditPictures(p)
  const outfit = pics.findIndex((x) => x.role === 'outfit')
  const sentences = pics.map((pic, i) => {
    if (pic.firstFrame) return `<Picture ${i + 1}> is the edited first frame.`
    const sentence = (EDIT_ROLE_SENTENCE[pic.role ?? ''] ?? ((n: number) => `Use what <Picture ${n}> shows.`))(i + 1)
    // "…shown in <Picture 1>: a woman with short silver hair." — the words are
    // what move a person; the edit LoRA takes only outfits and places from pixels.
    let out = pic.note ? `${sentence.replace(/\.$/, '')}: ${pic.note.replace(/\.$/, '')}.` : sentence
    // The person's description names their own clothes; with an outfit picture
    // those must not win (the ref2v lesson of 2026-09-13).
    if (pic.role === 'character' && outfit >= 0) {
      out = `${out.replace(/\.$/, '')}, wearing the outfit from <Picture ${outfit + 1}> instead of their own clothes.`
    }
    return out
  })
  return [`${H3_EDIT[kind].trigger} ${p.prompt.trim()}`, ...sentences].join(' ')
}

/**
 * Alissonerdx's head swap template (docs/head-swap.md, Apache-2.0), with the
 * user's description of the new face in its "Facial details" line — the author
 * says that line must describe the actual reference picture.
 */
export function h3HeadSwapPrompt(faceDetails: string): string {
  return [
    'head_swap:',
    '',
    'subject_definitions:',
    '',
    '<Subject 1> is the reference head identity from <Picture 1>, including the complete head, facial identity, facial structure, head shape, hairstyle, hairline, skin appearance, proportions, and all distinctive visual features.',
    '',
    'Facial details of <Subject 1>:',
    faceDetails.trim(),
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
    "<Video 1> (entire target timeline): partially_preserved - the original video timing, body motion, camera movement, framing, lighting, background, environment, scene composition, and temporal structure are preserved; only the subject's head appearance is modified.",
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

/**
 * The Person picture an edit swaps the face to after rendering, or null.
 *
 * Measured 2026-10-03: every edit route moves hair, tattoo and outfit but only
 * half the face (ArcFace 0.2-0.44); our swap on top reached 0.82. Only a picture
 * the form has checked for a face qualifies (`editFaceChecked`), and never on a
 * Restyle — a style picture is not a person.
 */
export function h3EditFaceSwap(
  p: Pick<VideoGenerationParams, 'mode' | 'editKind' | 'editPictures' | 'editPictureRoles' | 'editFirstFrame' | 'editSwapFace' | 'editFaceChecked' | 'editFollow'>,
): string | null {
  if (p.mode !== 'edit' || h3EditKind(p) === 'style' || p.editSwapFace === false) return null
  const person = h3EditPictures(p).find((x) => x.role === 'character')
  return person && p.editFaceChecked === person.file ? person.file : null
}

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
 * What the prompt writer binds each roled picture with — `_BIND_CLAUSE` in
 * h3_brain.py, same order, same words (a test reads that file and compares).
 */
const BIND_CLAUSE: Record<string, string> = {
  character: 'The character in every shot is the person from {tag}',
  face: 'The character has the face from {tag}: the same person, seen close up',
  outfit: 'The character wears the outfit from {tag} in every shot, in place of the clothes in {char}',
  prop: 'The object in the scene is the object from {tag}',
  location: 'The setting is the place from {tag}',
  style: 'The look is that of {tag}',
}
/** Each role's MiniMax marker — `REF_IMAGE_ROLES` in h3_brain.py. */
const ROLE_MARKER: Record<string, string> = {
  character: 'fully_preserved', face: 'attribute_transfer', outfit: 'attribute_transfer',
  prop: 'fully_preserved', location: 'fully_preserved', style: 'weak_reference',
}

/**
 * A reference-mode brief the user typed, given what the prompt writer would
 * have written around it: the declaration line, then one binding sentence per
 * roled picture. Null when there is nothing to add — no roled picture, or a
 * prompt that already cites its references (the writer's output, or a user
 * who tags by hand).
 *
 * Roles used to reach H3 only through the writer. Typed, nothing said which
 * picture was the outfit, and measured 2026-10-11 the outfit picture lost to
 * the character sheet's own clothes on 1 of 3 seeds — 2 of 3 with a face
 * close-up added — where the brief written through the tags held it 6/6.
 *
 * Pictures only: a video or sound's marker depends on what the user wants
 * from it, which only the writer can read out of the brief.
 */
export function h3TypedBriefBinding(
  p: Pick<VideoGenerationParams, 'prompt' | 'refImages' | 'refImageRoles'>,
): { declaration: string; binding: string } | null {
  if (/<(Picture|Video|Audio) \d+>/.test(p.prompt ?? '')) return null
  const roles = compactRefRoles(p.refImages, p.refImageRoles).map((r) => (r && r in BIND_CLAUSE ? r : null))
  if (!roles.some(Boolean)) return null
  const tag = (i: number) => `<Picture ${i + 1}>`
  const marker = (r: string | null) =>
    r === 'character' && roles.includes('outfit') ? 'partially_preserved' : (r && ROLE_MARKER[r]) ?? 'fully_preserved'
  const char = roles.includes('character') ? tag(roles.indexOf('character')) : 'the character picture'
  const order = Object.keys(BIND_CLAUSE)
  const binding = roles
    .flatMap((r, i) => (r ? [{ r, i }] : []))
    .sort((a, b) => order.indexOf(a.r) - order.indexOf(b.r) || a.i - b.i)
    .map(({ r, i }) => BIND_CLAUSE[r].replace('{tag}', tag(i)).replace('{char}', char) + '.')
    .join(' ')
  return {
    declaration: 'For the target video, the attached references are used as follows: ' +
      roles.map((r, i) => `${tag(i)} is ${marker(r)}.`).join(' '),
    binding,
  }
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

/**
 * The H3 clip's own encode. Core SaveVideo's `auto` keeps libx264's crf 23 — about 1.4 Mbit/s at 736x1344 — and a
 * Continue loads that very mp4 as its frozen head, so each link re-rendered the last one's compression blotches as
 * skin (Hotel Confession review, 2026-10-15: skin detail rose ~18 % from link 1 to link 5). crf 12 is near-lossless
 * at ~3x the file size. `format` is a V3 dynamic combo: the nested choices go in as `format.codec…` keys.
 */
export const H3_SAVE_CRF = 12

/**
 * How far the RTX upscale takes the clip. 1.5x, and deliberately not offered as
 * a dial: the node accepts 1-4, but H3 renders at most 768x1344, so 1.5x is
 * already past 1080p on the long edge of a portrait clip, and the factor costs
 * its own square in pixels, file size and upscaler time for detail the sampler
 * never rendered. Safe at any H3 size: `h3Dims` only emits multiples of 16, and
 * 1.5x of one is a multiple of 24 — still even, which h264 requires.
 *
 * The numbers below were measured at 2x, the value this shipped with until
 * 2026-09-06; 1.5x is the same pass at a smaller factor, not a different one.
 *
 * Measured 2026-09-05 on a real 672x960 clip, both legs to an identical
 * 1344x1920: **+26% detail over a lanczos upscale on Laplacian mean and p99
 * alike (2.476/13.449 vs 1.970/10.653), in HALF the wall time** — 18 s against
 * 36 s, because this is a dedicated GPU effect while `ImageScaleBy` grinds
 * through torch. Do not compare either figure against the source clip's own
 * 4.774/27.874: per-pixel Laplacian always falls when edges spread over four
 * times the pixels, so only same-size legs are comparable.
 *
 * Two things it is not. **It does nothing for face identity** — the upscaled
 * clip scored 0.596 mean / 0.892 last frame against its own source's 0.603 /
 * 0.895 — so this is a finishing pass, never a fix for a drifting face. And it
 * runs **per frame** (`sr.run(input_frame)` in a loop), which shows up as
 * +17.6% more frame-to-frame texture change than lanczos: some shimmer, still
 * below the source clip's own.
 *
 * NVIDIA-only by construction — the node wraps NVIDIA's Video Effects SDK
 * (`nvvfx.VideoSuperRes`). The pack is pinned, so the node exists everywhere,
 * but on AMD it will fail at execution rather than being absent.
 */
export const H3_UPSCALE_SCALE = 1.5

/**
 * Frames per second RIFE interpolates up to: 1.5x H3's fixed 24, not 2x. 48 is
 * smoother than most people want a rendered clip to look, and every frame past
 * 24 is also a frame the grain, sharpen and upscale passes have to pay for.
 *
 * A non-power-of-two ratio is fine here — this RIFE wrapper resamples on
 * arbitrary timestamps (`_calculate_target_frame_positions` in
 * `ComfyUI-VFI/rife/rife_comfyui_wrapper.py`), so it asks the model for t=1/3
 * and t=2/3 rather than recursively halving. Interpolated-frame count is
 * unchanged from 48 (one per source pair either way); only the copies drop.
 */
export const H3_RIFE_FPS = 36

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
 * **`high` is 0.72, and that number is a crash guard, not a quality choice.**
 * With `--enable-triton-backend` on (every NVIDIA box with triton >=3.7, which
 * the launcher enables for a measured 1.37-1.43x), an H3 render above roughly
 * 800 latent cells — `(w/32) * (h/32)` — takes ComfyUI down outright:
 * `Triton Error [CUDA]: an illegal memory access` inside
 * `triton/runtime/autotuner.py`, ~11-30 s in, while it autotunes kernels for
 * that shape. Swept 2026-09-04 on both the Eros and the stock checkpoint:
 * 560/630/704/735/768/792 cells all render, 840 crashed 3/3, 966 crashed. It is
 * size, not aspect — 768x1024 and 672x1120 both pass while 768x1120 dies.
 *
 * 0.72 is the largest budget whose **worst case over every aspect** (780 cells,
 * at 1248x640) stays inside the verified-safe band; 0.74 reaches 800 and lands
 * in the untested 792-840 gap. Quality wanted more: at 840 cells the same clip
 * scored +19% on face identity through its final shot. That is the trade the
 * cap costs, and it comes back the moment the crash is fixed — so if you raise
 * this, re-run the shape sweep first, and note the model's own canvas
 * (768x1344 = `MAX_PIXELS`, 1.03 MP) is the real ceiling above it.
 *
 * ponytail: the 0.6 middle step is still interpolated. The 2026-08-30 budget
 * sweep could not size the small tiers — peak VRAM went *down* as resolution
 * went up, because ComfyUI adapts residency to what is free — so only real
 * 16 GB hardware can set them.
 */
export const BUDGET_MP: Record<Tier, number> = { low: 0.4, medium: 0.6, high: 0.72 }

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
export type H3Task = 't2v' | 'i2v' | 'fl2v' | 'l2v' | 'ref2v' | 'continue'

export function h3Task(
  p: Pick<VideoGenerationParams, 'mode' | 'inputImage' | 'endImage' | 'continueFrom'>,
): H3Task {
  if (p.mode === 'ref2v') return 'ref2v'
  // Not one of MiniMax's tasks but ours: t2v with the previous clip's tail
  // pinned at frame 0. The builder clears both frame slots for it, so a stale
  // start frame must not read as i2v here either — and the writer needs to
  // know, because the look is already decided and it is shown the tail frame.
  if (p.continueFrom) return 'continue'
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
  profileShift?: { video: number; audio: number },
  profileLora?: { name: string; strength: number },
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
  //
  // Edit mode's LoRA goes on before all of it: it was trained on the bare
  // checkpoint, and the user's slots then stack over it the way they stack
  // over Turbo.
  // Loosely runs MiniMax's own reference route: no edit LoRA at all.
  if (params.mode === 'edit' && params.editFollow !== 'loose') {
    const ffp = h3EditPictures(params).some((x) => x.firstFrame)
    lora(ffp ? H3_EDIT_FFP_LORA : H3_EDIT[h3EditKind(params)].lora, 1)
  }
  // A checkpoint profile that is not distilled brings its own turbo LoRA (SparseRef15); first, so user LoRAs stack on it.
  if (profileLora) lora(profileLora.name, profileLora.strength)
  if (tier) {
    const useRef2v = (params.mode === 'ref2v' || params.mode === 'edit') && params.ref2vTurbo === true
    lora(useRef2v ? H3_REF2V_TURBO_LORA : H3_TURBO[tier].lora, H3_TURBO[tier].strength)
  }
  for (const l of userLoras(params)) lora(l.name, l.strength)

  // Realism last of the weight patches, so a user LoRA in a slot still stacks
  // over it the way it stacks over Turbo. Gated on the form having confirmed the
  // file is on disk — same contract as the Turbo tiers, because naming a missing
  // LoRA fails ComfyUI's validation for the whole prompt rather than degrading.
  if (params.realismLora === true) lora(H3_REALISM_LORA, H3_REALISM_STRENGTH)

  // A Turbo tier's shift, or the shift a checkpoint profile's card asks for (Eros beta6: 10/3).
  const shift = tier ? H3_TURBO[tier].shift : profileShift
  if (shift) {
    link({
      class_type: 'MiniMaxH3SigmaShift',
      _meta: { title: 'MiniMax H3 Sigma Shift' },
      inputs: {
        model: [head, 0],
        shift_video: shift.video,
        shift_audio: shift.audio,
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

/**
 * The finishing chain — RIFE, then upscale, then sharpen, then grain — spliced
 * over whatever currently feeds `videoId`'s images.
 *
 * Lifted out of `buildPrompt` because the post-render face swap runs it too.
 * With `params.swapFaces` the render skips this block entirely and the swap job
 * appends it after the swap instead, which buys two things: the swapper works
 * on 1x frames at 1x size rather than 1.5x frames at 2.25x the area, and the
 * grain and sharpen land ON the swapped face instead of around it — a swap over
 * a finished clip pastes a clean synthesised face into a grained frame, leaving
 * a smooth face-shaped patch, which is the exact look grain is there to fix.
 *
 * ponytail: hardcoded to H3's constants and its fixed 24 fps rather than taking
 * six knobs nothing varies. LTX bakes its own RIFE into its graph and has none
 * of the other three, so it has nothing to share here.
 */
export type VideoPostParams = Pick<VideoGenerationParams, 'rife' | 'upscale' | 'sharpen' | 'filmGrain'>

export function appendVideoPost(
  wf: ComfyUIPrompt,
  videoId: string,
  opts: VideoPostParams,
  freshId: () => string,
): void {
  // RIFE resamples the frames to `H3_RIFE_FPS`, so the container fps has to
  // move with it or the clip plays slow and drifts out of sync with its own
  // audio track — which H3 generates jointly and RIFE never sees.
  if (opts.rife === true) {
    const rife = freshId()
    wf[rife] = {
      class_type: 'RIFEInterpolation',
      _meta: { title: 'RIFE Interpolation' },
      inputs: {
        // Whatever is currently feeding the container, not DECODE_ID: a
        // continuation puts a trim in between, and reading past it would
        // interpolate the pinned head straight back into the delivered clip.
        images: wf[videoId].inputs.images,
        source_fps: H3_FPS,
        target_fps: H3_RIFE_FPS,
        scale: 1,
      },
    }
    wf[videoId].inputs.images = [rife, 0]
    wf[videoId].inputs.fps = H3_RIFE_FPS
  }

  // RTX Video Super Resolution. Its place in the chain is fixed at both ends.
  //
  // AFTER RIFE, because the alternative is worse arithmetic: upscaling first
  // makes RIFE interpolate four times the pixels, while this way RIFE stays
  // cheap and the upscaler merely sees twice as many frames — and at 18 s per
  // 294 frames, frames are the cheap axis.
  //
  // BEFORE sharpen and grain, because both belong at the delivered
  // resolution. Grain especially: magnifying fine grain 2x turns it into
  // blotches, which is the opposite of the point.
  if (opts.upscale === true) {
    const up = freshId()
    wf[up] = {
      class_type: 'RTXVideoSuperResolution',
      _meta: { title: 'RTX Video Super Resolution' },
      inputs: {
        // Off the container, not the decoder — same reason as the sharpener:
        // a continuation trims the pinned head out in between.
        images: wf[videoId].inputs.images,
        // Another V3 dynamic combo, same dotted spelling as the sharpener's
        // `method`. A nested `{resize_type, scale}` object is accepted by the
        // server and then silently dropped, and the node dies with
        // "execute() missing 1 required positional argument: 'resize_type'".
        resize_type: 'scale by multiplier',
        'resize_type.scale': H3_UPSCALE_SCALE,
        quality: 'ULTRA',
      },
    }
    wf[videoId].inputs.images = [up, 0]
  }

  // RCAS sharpen — one cheap pass against H3's softness. See
  // H3_SHARPEN_STRENGTH for why 0.3 and not the node's own 0.8.
  //
  // Its place in the chain is between RIFE and grain, and both edges matter:
  // sharpening *before* RIFE would leave the interpolated frames unsharpened
  // while the real ones were, so crispness would alternate frame to frame;
  // sharpening *after* grain would sharpen the grain into crunch instead of
  // sharpening the picture.
  if (opts.sharpen === true) {
    const sharp = freshId()
    wf[sharp] = {
      class_type: 'ImageSharpenKJ',
      _meta: { title: 'RCAS sharpen' },
      inputs: {
        // Read off the container, not the decoder: a continuation trims the
        // pinned head out in between, and reading past that would sharpen —
        // and re-attach — frames this clip is supposed to drop.
        image: wf[videoId].inputs.images,
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
    wf[videoId].inputs.images = [sharp, 0]
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
  // Default OFF since 2026-10-14 (it was opt-out before, as the cheap corrective
  // for airbrushed skin): the realism adapter now does that job, and the owner's
  // reference clips and every clip he called "very good" in that day's tests
  // rendered with no grain, sharpen or upscale — grain over matte skin read as
  // noise. Opt-in, so only an explicit `true` adds it.
  if (opts.filmGrain === true) {
    appendFilmGrain(wf, videoId, { intensity: H3_GRAIN_INTENSITY })
  }
}

/**
 * Parts 2..n of an edit too big for one render, then the stitch.
 *
 * Part 1 is the graph v1 builds. Every later part repeats its conditioning →
 * anchor → guider → sampler → decodes over its own span of the source, sharing
 * the model chain, text encoder, VAEs, noise, sampler and sigmas — so it is one
 * ComfyUI job, one gallery clip. Seamless freezes the previous part's last 39
 * decoded frames (and their sound) at the head of the next with the same node
 * Continue uses; both joins drop each later part's overlap when stitching.
 * The sound is the source's own span per part (VHS slices it to the frames it
 * loads), or H3's own when the source is silent, trimmed to the frames each
 * part delivers so the overlap is never heard twice.
 */
function appendEditChunks(
  wf: Wf,
  params: VideoGenerationParams,
  plan: EditChunk[],
  loadId: string,
  freshId: () => string,
): void {
  // The plan is the one truth about the join (a first frame forces Seamless).
  const seamless = plan[1]?.overlap !== EDIT_JOIN_OVERLAP.fast
  const vae = wf[DECODE_ID].inputs.vae
  const audioVae = wf[AUDIO_ID].inputs.vae
  const sampler = idOf('SamplerCustomAdvanced')
  const hasSound = params.editSourceHasAudio === true
  const parts: { frames: [string, number]; audio: [string, number]; sound: [string, number] }[] = [
    { frames: [DECODE_ID, 0], audio: [AUDIO_ID, 0], sound: hasSound ? [loadId, 2] : [AUDIO_ID, 0] },
  ]

  plan.slice(1).forEach((c, i) => {
    const n = i + 2
    const prev = parts[i]
    const cond = freshId()
    wf[cond] = { ...wf[COND_ID], _meta: { title: `Edit part ${n}: conditioning` }, inputs: { ...wf[COND_ID].inputs, length: c.frames } }
    // A first-frame edit: this part's <Picture 1> is the previous part's frame
    // where this part starts (its frozen head's first frame), so every part has
    // its own edited first frame and the same prompt.
    if (h3EditPictures(params)[0]?.firstFrame) {
      const pick = freshId()
      wf[pick] = {
        class_type: 'ImageFromBatch',
        _meta: { title: `Part ${n}'s first frame, from part ${n - 1}` },
        inputs: { image: prev.frames, batch_index: plan[i].frames - c.overlap, length: 1 },
      }
      wf[cond].inputs['ref_images.ref_image_0'] = [pick, 0]
    }
    const load = freshId()
    wf[load] = {
      ...wf[loadId],
      _meta: { title: `Clip to edit, part ${n}` },
      inputs: { ...wf[loadId].inputs, skip_first_frames: c.start, frame_load_cap: c.frames },
    }
    let conditioning: [string, number] = [cond, 0]
    if (params.editFollow === 'loose') {
      // The part's own span as its <Video 1> (the load is half size, copied from part 1's).
      wf[cond].inputs['ref_videos.ref_video_0'] = [load, 0]
    } else {
      const guide = freshId()
      wf[guide] = {
        class_type: 'MiniMaxH3AddGuide',
        _meta: { title: `Anchor part ${n} at its frame 0` },
        inputs: { positive: [cond, 0], latent: [cond, 1], vae, image: [load, 0], frame_idx: 0 },
      }
      conditioning = [guide, 0]
    }
    const guider = freshId()
    wf[guider] = {
      class_type: 'BasicGuider',
      _meta: { title: `Edit part ${n}: guider` },
      inputs: { model: wf[GUIDER_ID].inputs.model, conditioning },
    }
    let latent: [string, number] = [cond, 1]
    if (seamless) {
      const prefix = freshId()
      wf[prefix] = {
        class_type: 'RaccoonH3MaskedPrefix',
        _meta: { title: `Freeze part ${n - 1}'s last ${H3_CONTEXT_FRAMES} frames` },
        inputs: { latent, vae, audio_vae: audioVae, video: prev.frames, audio: prev.audio, context_frames: H3_CONTEXT_FRAMES },
      }
      latent = [prefix, 0]
    }
    const sample = freshId()
    wf[sample] = {
      class_type: 'SamplerCustomAdvanced',
      _meta: { title: `Edit part ${n}: sampler` },
      inputs: { ...wf[sampler].inputs, guider: [guider, 0], latent_image: latent },
    }
    const dec = freshId()
    wf[dec] = { class_type: 'VAEDecode', _meta: { title: `Edit part ${n}: decode` }, inputs: { samples: [sample, 0], vae } }
    const decAudio = freshId()
    wf[decAudio] = {
      class_type: 'VAEDecodeAudio',
      _meta: { title: `Edit part ${n}: decode sound` },
      inputs: { samples: [sample, 0], vae: audioVae },
    }
    parts.push({ frames: [dec, 0], audio: [decAudio, 0], sound: hasSound ? [load, 2] : [decAudio, 0] })
  })

  const trim = (sound: [string, number], c: EditChunk, n: number): [string, number] => {
    const id = freshId()
    wf[id] = {
      class_type: 'TrimAudioDuration',
      _meta: { title: `Part ${n}'s sound, without its overlap` },
      inputs: { audio: sound, start_index: c.overlap / H3_FPS, duration: (c.frames - c.overlap) / H3_FPS },
    }
    return [id, 0]
  }
  let images = parts[0].frames
  let sound = trim(parts[0].sound, plan[0], 1)
  for (let i = 1; i < plan.length; i++) {
    const cut = freshId()
    wf[cut] = {
      class_type: 'ImageFromBatch',
      _meta: { title: `Part ${i + 1} without its overlap` },
      // `length` is clamped to what is left, so this asks for "the rest".
      inputs: { image: parts[i].frames, batch_index: plan[i].overlap, length: 4096 },
    }
    const batch = freshId()
    wf[batch] = { class_type: 'ImageBatch', _meta: { title: `Join part ${i + 1}` }, inputs: { image1: images, image2: [cut, 0] } }
    images = [batch, 0]
    const cat = freshId()
    wf[cat] = {
      class_type: 'AudioConcat',
      _meta: { title: `Join part ${i + 1}'s sound` },
      inputs: { audio1: sound, audio2: trim(parts[i].sound, plan[i], i + 1), direction: 'after' },
    }
    sound = [cat, 0]
  }
  wf[VIDEO_ID].inputs.images = images
  wf[VIDEO_ID].inputs.audio = sound
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
    const { codec: _auto, ...save } = wf[SAVE_ID].inputs
    wf[SAVE_ID].inputs = { ...save, format: 'mp4', 'format.codec': 'h264', 'format.codec.encoding': 're-encode', 'format.codec.encoding.crf': H3_SAVE_CRF }
    const cond = wf[COND_ID].inputs
    // Above the mode branch: ref2v allocates loader ids before the model chain does.
    const freshId = makeIds()

    // A continuation opens on its pinned head, so a start or end frame would
    // fight it — nothing can honour two different things at frame 0. Cleared
    // here rather than trusted to the caller, so every downstream read (task
    // derivation, the aspect anchor, the loader splice) sees one truth.
    if (params.continueFrom) params = { ...params, inputImage: undefined, endImage: undefined }

    const editing = params.mode === 'edit'
    // Edit takes nothing from the other modes: no frames, no continuation, no
    // seed hunt (candidates are a separate cheap graph), no realism trigger in
    // front of the edit trigger.
    if (editing) {
      // refHiFi is reference mode's: 'max' would size Edit's pictures far past
      // the tokens the part planner counts for them.
      params = { ...params, continueFrom: undefined, inputImage: undefined, endImage: undefined, seedHunt: false, realismLora: false, refHiFi: false }
    }
    const editPlan = editing ? h3EditPlan(params) : null
    if (editing && (!params.editSource || !params.editSourceFrames || !params.editSourceWidth || !params.editSourceHeight)) {
      throw new Error('Pick the clip to edit first (and let it finish reading)')
    }
    if (editing && editPlan === null) {
      throw new Error('Edit takes clips up to 15 s — trim this one first')
    }

    const realism = (p: string) => (params.realismLora === true ? withRealismTrigger(p) : p)
    const typed = params.mode === 'ref2v' ? h3TypedBriefBinding(params) : null
    cond.prompt = editing
      ? h3EditPrompt(params)
      // The declaration stays the first line; the trigger goes under it.
      : typed ? `${typed.declaration}\n\n${realism(`${typed.binding}\n\n${params.prompt}`)}`
      : realism(params.prompt)
    // Part 1's length — the whole clip whenever it fits in one render.
    cond.length = editing ? editPlan![0].frames : h3FrameCount(h3ClampDuration(params.durationSeconds))
    wf[VIDEO_ID].inputs.fps = H3_FPS

    const tier = tierOf(params.vramMode)
    const budget = params.budgetMp ?? BUDGET_MP[tier]

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
    // An edit follows its source clip's shape, inside the same VRAM budget.
    // In reference mode the first keyframe decides — those pictures ARE frames
    // of the clip, unlike the references.
    const keyframeShape = params.mode === 'ref2v'
      ? H3_KEYFRAME_SLOTS.map((s) => params.keyframes?.[s]).find((k) => k?.image && k.width && k.height)
      : undefined
    const anchor = editing
      ? params.editSourceWidth! / params.editSourceHeight!
      : keyframeShape
        ? keyframeShape.width! / keyframeShape.height!
        : params.inputImage && params.inputImageWidth && params.inputImageHeight
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
    // Edit runs on the same conditioning — the edit LoRAs were trained in
    // reference mode — but with no references: only ref2v loads them.
    if (params.mode === 'ref2v' || editing) {
      // Eros overwrites this further down — its weights carry ref2va's lineage,
      // so reference mode is a checkpoint pick like any other mode.
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
      if (params.mode === 'ref2v') {
        orderedRefImages(params.refImages, params.refImageRoles).forEach(({ file, role }, i) => {
          const id = freshId()
          wf[id] = {
            class_type: 'LoadImage',
            _meta: { title: `Reference <Picture ${i + 1}>${role ? ` (${role})` : ''}` },
            inputs: { image: file },
          }
          let src: [string, number] = [id, 0]
          if (role && FACELESS_REF_ROLES.has(role)) {
            const crop = freshId()
            wf[crop] = {
              class_type: 'RaccoonHeadlessReference',
              _meta: { title: `<Picture ${i + 1}> without its face` },
              inputs: { image: src },
            }
            src = [crop, 0]
          }
          cond[`ref_images.ref_image_${i}`] = src
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
      // Edit's own pictures. Same loader + face crop as reference mode; every
      // later part copies these conditioning inputs, so all parts see them.
      if (editing) {
        h3EditPictures(params).forEach(({ file, role }, i) => {
          const id = freshId()
          wf[id] = {
            class_type: 'LoadImage',
            _meta: { title: `Edit <Picture ${i + 1}>${role ? ` (${role})` : ''}` },
            inputs: { image: file },
          }
          let src: [string, number] = [id, 0]
          if (role && FACELESS_REF_ROLES.has(role)) {
            const crop = freshId()
            wf[crop] = {
              class_type: 'RaccoonHeadlessReference',
              _meta: { title: `<Picture ${i + 1}> without its face` },
              inputs: { image: src },
            }
            src = [crop, 0]
          }
          cond[`ref_images.ref_image_${i}`] = src
        })
      }
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
    // `buildModelChain` adds no Turbo LoRA; the only shift is the profile's own.
    // The Hybrid (Plaguekind's recipe) is the same kind of pick: its own file
    // and its own schedule, with no Turbo to stack.
    const profile = h3Profile(params)
    // Hunting upgrades "no Turbo" to Draft — the cheapest tier, since the point
    // is throwaway candidates — but honours an explicit Fast pick rather than
    // quietly downgrading someone who chose it.
    const speed = profile ? null : (h3TurboTier(params.turbo) ?? (hunting ? 'draft' : null))
    if (profile) {
      wf[MODEL_ID].inputs.unet_name = profile.ckpt
      wf[SAMPLER_ID].inputs.sampler_name = params.h3Sampler ?? profile.sampler
      wf[SCHED_ID].inputs.scheduler = profile.scheduler
    }
    // Candidates take the profile's cheaper count: with no Draft tier to fall
    // back on, that step cut is the entire seed-hunt discount.
    wf[SCHED_ID].inputs.steps = profile
      ? hunting
        ? profile.huntSteps
        : profile.steps
      : speed
        ? H3_TURBO[speed].steps
        : H3_STEPS.normal
    const model = buildModelChain(
      wf, params, speed, freshId,
      profile && 'shift' in profile ? profile.shift : undefined,
      profile && 'lora' in profile ? profile.lora : undefined,
    )
    if (model !== MODEL_ID) {
      wf[SCHED_ID].inputs.model = [model, 0]
      wf[GUIDER_ID].inputs.model = [model, 0]
    }

    // ── Edit: anchor the whole source clip at frame 0 ──────────────────────────
    //
    // VHS_LoadVideo rather than core LoadVideo: an uploaded phone clip is 30 or
    // 60 fps and 1080p, and core can neither resample (the edit would play in
    // slow motion) nor downscale (above ~800 latent cells the triton backend
    // crashes). VHS does both, plus the frame cap, and accepts the ` [output]`
    // annotation like core does.
    if (editing) {
      const load = freshId()
      wf[load] = {
        class_type: 'VHS_LoadVideo',
        _meta: { title: 'Clip to edit' },
        inputs: {
          video: params.editSource!,
          force_rate: H3_FPS,
          // Loosely hands the clip over as a reference video at HALF size in each
          // direction: full size rendered noise in the spike, half size clean.
          custom_width: params.editFollow === 'loose' ? Number(cond.width) / 2 : cond.width,
          custom_height: params.editFollow === 'loose' ? Number(cond.height) / 2 : cond.height,
          frame_load_cap: cond.length,
          skip_first_frames: 0,
          select_every_nth: 1,
        },
      }
      if (params.editFollow === 'loose') {
        // MiniMax's own route: the clip is <Video 1>, a reference, not an anchor.
        cond['ref_videos.ref_video_0'] = [load, 0]
      } else {
        const guide = freshId()
        wf[guide] = {
          class_type: 'MiniMaxH3AddGuide',
          _meta: { title: 'Anchor the whole clip at frame 0' },
          inputs: {
            positive: [COND_ID, 0],
            latent: [COND_ID, 1],
            vae: wf[DECODE_ID].inputs.vae,
            image: [load, 0],
            frame_idx: 0,
          },
        }
        wf[GUIDER_ID].inputs.conditioning = [guide, 0]
      }
      // The source's own sound. A clip with no audio stream keeps H3's track:
      // VHS extracts audio with ffmpeg and raises on a stream-less file.
      if (params.editSourceHasAudio === true) wf[VIDEO_ID].inputs.audio = [load, 2]
      if (editPlan!.length > 1) appendEditChunks(wf, params, editPlan!, load, freshId)
      // The face, after the whole clip is stitched and before the finishing
      // chain grains or upscales it. Threshold 0: the clip's main face is the
      // one replaced (several people keep the manual "Swap faces & finish").
      const face = h3EditFaceSwap(params)
      if (face) {
        const swap = appendVideoFaceSwap(
          wf,
          wf[VIDEO_ID].inputs.images as [string, number],
          { characters: [{ reference: face, sourceImage: face }], matchThreshold: 0, strict: false },
          'edit-swap',
        )
        wf[VIDEO_ID].inputs.images = [swap, 0]
      }
    }

    // ── Keyframes: pictures a reference render must hit ────────────────────────
    //
    // `MiniMaxH3ReferenceToVideo` has no frame inputs, but core AddGuide works on
    // its conditioning: it reads the latent only for its shape and hands the
    // conditioning back, so the guides chain around the guider's input in time
    // order. Measured 2026-10-02: 9.5 / 10.2 / 8.7 against ~50 without, same
    // render time. Placed before the continuation splice, which reads `cond`
    // but never the guider.
    for (const k of h3Keyframes(params, Number(cond.length))) {
      const load = freshId()
      wf[load] = { class_type: 'LoadImage', _meta: { title: `Keyframe (${k.slot})` }, inputs: { image: k.image } }
      const guide = freshId()
      wf[guide] = {
        class_type: 'MiniMaxH3AddGuide',
        _meta: { title: `Land on the ${k.slot} keyframe at frame ${k.frame}` },
        inputs: {
          positive: wf[GUIDER_ID].inputs.conditioning,
          latent: [COND_ID, 1],
          vae: wf[DECODE_ID].inputs.vae,
          image: [load, 0],
          frame_idx: k.frame,
        },
      }
      wf[GUIDER_ID].inputs.conditioning = [guide, 0]
    }

    // ── Continuation: freeze the previous clip's tail, then trim it back off ──
    //
    //   LoadVideo -> GetVideoComponents -> RaccoonH3MaskedPrefix (our one node:
    //   core carries per-stream H3 denoise masks, no stock node builds one)
    //
    // Placed before the RIFE splice on purpose: trimming first means RIFE
    // interpolates fewer frames, and the frame index stays in *source* frames
    // rather than multiplying with the output fps.
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
       * back 1088×608: the old `AddGuide` pin **resized the guide to the target rather than
       * refusing**, so it centre-cropped a thin band out of the portrait frames
       * and upscaled it — wrong framing and a large quality loss, with no error
       * anywhere. Reported from a real render.
       *
       * Carrying width/height through params instead would work until they
       * drifted; taking them off the source's own frames cannot disagree with
       * it. `GetImageSize` is core.
       *
       * **The source's shape, at this render's budget** (2026-10-14). The saved
       * clip is not the render: with Upscale on it is 1.5x larger, so sizing
       * from it as-is made every link render bigger than the last. Measured on a
       * helper chain: 480x864 → 720x1296 → 1072x1936, the third link at twice
       * H3's ~1 MP canvas, ~5x slower per step (21 → 105 s) and darker each
       * link, and the pinned tail arrived already sharpened and grained. Core
       * `ImageScaleToTotalPixels` brings the frames back to the tier's budget on
       * H3's /32 grid first, so the pinned frames and the latent agree, and an
       * unscaled source comes out at the size it already had.
       *
       * The area is what a fresh render gets (`d`, already clamped to the
       * model's canvas), not the raw budget: the node scales up as well as
       * down, so at a full-canvas budget (1.0 MP) a 736x1344 link came back
       * 768x1376, past H3's 1344 long edge (2026-10-14).
       */
      const fit = freshId()
      wf[fit] = {
        class_type: 'ImageScaleToTotalPixels',
        _meta: { title: 'Previous clip at this render’s budget' },
        inputs: { image: [split, 0], upscale_method: 'bicubic', megapixels: (d.w * d.h) / (1024 * 1024), resolution_steps: 32 },
      }
      const size = freshId()
      wf[size] = {
        class_type: 'GetImageSize',
        _meta: { title: 'Match the previous clip’s size' },
        inputs: { image: [fit, 0] },
      }
      cond.width = [size, 0]
      cond.height = [size, 1]

      // The tail goes INTO the latent, frozen by a denoise mask of 0, so the
      // sampler keeps its picture and sound as they were and generates only what
      // follows. The node takes the whole clip and slices the tail itself, the
      // sound by time, so the two can never drift apart.
      const prefix = freshId()
      wf[prefix] = {
        class_type: 'RaccoonH3MaskedPrefix',
        _meta: { title: `Freeze previous ${H3_CONTEXT_FRAMES} frames` },
        inputs: {
          latent: [COND_ID, 1],
          // Both VAEs by role, never by id: this graph has two VAELoaders and
          // which is which is decided by what the decoders already read. The
          // ref2v branch identifies the audio one the same way.
          vae: wf[DECODE_ID].inputs.vae,
          audio_vae: wf[AUDIO_ID].inputs.vae,
          video: [fit, 0],
          audio: [split, 1],
          context_frames: H3_CONTEXT_FRAMES,
        },
      }
      wf[idOf('SamplerCustomAdvanced')].inputs.latent_image = [prefix, 0]
      const pinned = H3_CONTEXT_FRAMES

      // The pinned frames come back at the head of the render and have to come
      // off before the clip is saved, picture and sound together, or every join
      // repeats a second of the previous clip.
      const deliveredS = (Number(cond.length) - pinned) / H3_FPS
      const cutFrames = freshId()
      wf[cutFrames] = {
        class_type: 'ImageFromBatch',
        _meta: { title: 'Drop pinned head' },
        inputs: {
          image: wf[VIDEO_ID].inputs.images,
          batch_index: pinned,
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
          start_index: pinned / H3_FPS,
          duration: deliveredS,
        },
      }
      wf[VIDEO_ID].inputs.audio = [cutAudio, 0]
    }

    // The finishing chain, unless the user asked to swap faces first — then it
    // runs in the swap job instead, over the swapped frames. See appendVideoPost.
    if (!params.swapFaces) appendVideoPost(wf, VIDEO_ID, params, freshId)

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
