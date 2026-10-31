import type { ComfyUIPrompt } from './comfyui'
import type { DirectorTimeline } from '@/lib/workflows/director-timeline'

/** Where a keyframe sits in an H3 reference render. See `h3KeyframeFrames`. */
export type H3KeyframeSlot = 'start' | 'middle' | 'end'
/** One keyframe picture: an input/ filename plus its pixel size for framing. */
export interface H3Keyframe { image: string; width?: number; height?: number }

export interface VideoGenerationParams {
  /** → RaccoonVideoPrompt.confirmed_prompt (required, non-empty; ComfyUI rejects empty). */
  prompt: string
  /**
   * `director` is only ever handled by the ltx23-director workflow; the ltx23
   * builder never receives it (the two are separate `VideoWorkflowDefinition`s
   * selected by id).
   */
  mode: 't2v' | 'i2v' | 'ref2v' | 'director' | 'edit'
  /**
   * Which video model family renders this job — a `VideoWorkflowDefinition.id`
   * (`ltx23` or `minimax-h3`). Ignored when `mode` is `director`, which is bound
   * to the ltx23-director graph.
   *
   * Optional and resolved defensively: this is persisted to localStorage, which
   * survives a reinstall, so an id naming a workflow that no longer exists must
   * fall back to the default rather than leave the form pointing at nothing.
   */
  videoModel?: string
  /** t2v framing key: 'portrait' | 'landscape' | 'square'. */
  orientation?: string
  /** i2v: filename already uploaded to ComfyUI's input dir. */
  inputImage?: string
  /** i2v: source image pixel size — drives rm_w/rm_h (aspect-preserving ~2MP, /32). */
  inputImageWidth?: number
  inputImageHeight?: number
  /**
   * MiniMax H3 only: the frame the clip must **end** on, uploaded to ComfyUI's
   * input dir. Optional, and deliberately not its own `mode`.
   *
   * H3's base checkpoint is FL2VA — first-**and-last**-frame — and its node
   * takes `first_frame` and `last_frame` as two independent optional inputs.
   * Which of MiniMax's three documented tasks a render is therefore falls out
   * of which slots are filled, so a second image slot buys two modes where a
   * fourth mode button would have bought one:
   *
   * | `inputImage` | `endImage` | task  | what it does                      |
   * |--------------|------------|-------|-----------------------------------|
   * | yes          | —          | I2VA  | animate forward (unchanged)       |
   * | yes          | yes        | FL2VA | travel from one frame to the other|
   * | —            | yes        | L2VA  | converge onto a known final frame |
   *
   * `h3Task()` is the single reader of that table; nothing else should infer
   * the mode from these two fields. LTX has no `last_frame` input, so the slot
   * is offered for H3 only.
   */
  endImage?: string
  /** Pixel size of `endImage`, used for framing when there is no start image. */
  endImageWidth?: number
  endImageHeight?: number
  /**
   * MiniMax H3 `ref2v` only: filenames already uploaded to ComfyUI's input dir,
   * one per UI slot. **Sparse** — a cleared slot is `undefined` and the slot
   * after it keeps its position in this array.
   *
   * The node numbers `<Picture i>` by the presentation order of the references
   * it actually receives, so the builder compacts this list before emitting.
   * Read it only through `compactRefs`, never by raw index.
   */
  refImages?: (string | undefined)[]

  /**
   * What each picture in `refImages` is FOR — one of `H3_REF_ROLES`, or absent.
   * Sparse and index-aligned with `refImages`, and compacted against it by
   * `compactRefRoles` so role N always describes `<Picture N>`.
   *
   * The prompt writer never sees these images (ref2v is outside the node's
   * vision gate), so without a role it invents one from the brief. Absent is
   * the default and reproduces the pre-roles doctrine exactly.
   */
  refImageRoles?: (string | undefined)[]
  /**
   * ref2v: reference **video** filenames in ComfyUI's input dir, tagged
   * `<Video N>`. Sparse and compacted exactly like `refImages`.
   *
   * Each clip's own soundtrack is wired to the node's index-paired
   * `ref_video_audio_N` slot automatically. That is safe for a silent clip:
   * `GetVideoComponents` yields `None`, ComfyUI passes it through, and the H3
   * node skips it (`if soundtrack is not None`) — verified live 2026-08-11.
   *
   * The node truncates a reference clip to the *render's* frame count and to
   * the 17k+5 grid, and reads it as 24 fps.
   */
  refVideos?: (string | undefined)[]
  /**
   * ref2v: standalone reference **audio** filenames, tagged `<Audio N>` —
   * voice timbre or musical style. Separate from a reference video's own
   * soundtrack, which rides along with the clip.
   */
  refAudios?: (string | undefined)[]
  /**
   * MiniMax H3 `ref2v` only: pictures the clip must pass through — its first,
   * middle and last frame. Not references: no `<Picture N>`, no share of the
   * reference budget. Each filled slot is one core `MiniMaxH3AddGuide`, placed
   * by `h3KeyframeFrames`. Measured 2026-10-02: 9.5 / 10.2 / 8.7 against ~50
   * without (owner folder `261002 - H3 Anker-Videos Test`).
   */
  keyframes?: Partial<Record<H3KeyframeSlot, H3Keyframe>>
  /**
   * `ref_image_size: 'max'` — the reference pipeline's 2048px short edge instead
   * of scaling each reference to the render's pixel area. Off by default.
   *
   * The node's tooltip warns this "can be several times slower", but that is the
   * worst case, not the typical one: `max` never *upscales*, so the cost is set
   * by how much bigger the reference is than the render. Measured 2026-08-11 on
   * a 1344×768 reference at 864×480 — **1.07×** (160 s vs 150 s), and it gave
   * the best likeness of the four configurations tried. A 4K photo would be a
   * different story.
   */
  refHiFi?: boolean
  durationSeconds: number
  fps: number
  /** Negative = randomise (resolved to a concrete int at build). */
  seed: number
  /**
   * MiniMax H3 only: apply fal's realism-people adapter, which restores the skin
   * texture H3 renders away (pores, capillaries, stubble) instead of masking it
   * with film grain.
   *
   * Off by default and gated on the 125 MB file being installed, like the Turbo
   * tiers — the builder must never name a LoRA that is not on disk, because
   * ComfyUI rejects the whole prompt at validation rather than degrading.
   * Turning it on also injects the adapter's required trigger word into the
   * prompt (`withRealismTrigger`).
   */
  realismLora?: boolean
  /** Render-time negative-prompt inputs on the prompt node. */
  pov?: boolean
  povGender?: 'female' | 'male'
  music?: string
  /** Passed through to the node for run fidelity (primarily enhance-time controls). */
  environment?: string
  scenario?: string
  camera?: string
  dialogueTier?: 'none' | 'standard' | 'talkative'
  energy?: number
  /**
   * RIFE frame interpolation on the final clip.
   *
   * The two video graphs default opposite ways, because they are baked opposite
   * ways: LTX ships the node in its graph and `false` splices it out, while H3's
   * graph is core-only and `true` splices it in. Read it as
   * `rife !== false` for LTX and `rife === true` for H3 — never as a bare
   * truthiness check that would silently flip one of them.
   */
  rife?: boolean

  /**
   * Write the clip as ONE continuous shot instead of the duration table's 2-5.
   *
   * A prompt-writing switch, not a render one: it reaches `shot_budget` in
   * `h3_brain.py` through the enhance call, so it shapes what the writer
   * produces and does nothing to a prompt typed by hand.
   *
   * Measured 2026-09-04 on a 12 s i2v clip: face identity against the start
   * image holds at 0.85 through shot 1, 0.63 through shot 2 and 0.37 through
   * shot 3 — and falls only 0.88 -> 0.83 *within* shot 1. Identity dies at the
   * cuts, and it did so on the Eros checkpoint, on stock H3, and with and
   * without a character LoRA. So this is the cheapest fix for a face that
   * wanders; the price is a clip that cannot cut.
   */
  singleShot?: boolean

  /**
   * Run the finished frames through RTX Video Super Resolution at 1.5x.
   *
   * A delivery step, not a quality lever on the render itself: it cannot add
   * anything the sampler did not produce, and it measurably does nothing for
   * face identity. What it does buy is a big clip on a box that cannot render
   * one — H3 caps at 768x1344 and `BUDGET_MP.high` is capped below that again
   * for crash safety, so above ~0.8 MP upscaling is the only route there is.
   *
   * See `H3_UPSCALE_SCALE` for the measurements and for why it sits between
   * RIFE and the sharpener.
   */
  upscale?: boolean
  /**
   * MiniMax H3 only: which checkpoint the fl2va graph loads.
   *
   * `'eros'` is TenStrip's 10Eros Max (beta6) — an H3 finetune with adult
   * character grafted in and, load-bearingly, **its own Turbo merged into the
   * weights**. That is why this is a checkpoint pick rather than another LoRA
   * slot: it replaces the base model and the whole `turbo` dial at once (see
   * `H3_EROS`).
   *
   * Applies in every mode, `ref2v` included: the build's unquantized weights are
   * bit-identical to the stock ref2va build, so it is one checkpoint for all
   * five tasks. Read it through `h3UsesEros()` rather than comparing here, so
   * the builder and the cost model can never disagree about what it means.
   *
   * `hybrid` (2026-10-02) is Plaguekind V11's recipe: smhfacct's fl2va+ref2va
   * merge at res_multistep / 13 steps, no Turbo (`H3_HYBRID`). `h3Profile()`
   * is the reader for "this checkpoint owns its schedule".
   *
   * `sparseref` (2026-10-16) is Aki7777777's SparseRef15 Hybrid (fl2va with a sparse ref2va effect on 15 blocks),
   * Partial-INT8, run with lightx2v's fl2v turbo LoRA at 1.0, 8 steps, shift 12/3 (`H3_SPARSEREF`) — the steadiest
   * face of the helper's checkpoint round.
   */
  h3Checkpoint?: 'base' | 'eros' | 'hybrid' | 'sparseref'
  /**
   * A sampler in place of the checkpoint profile's own (the video helper's reseed ladder, 2026-10-18: `lcm` gave 10Eros
   * its cleanest speech). Only for checkpoints with a profile; unset = the profile's sampler.
   */
  h3Sampler?: 'euler' | 'lcm' | 'res_multistep'
  /**
   * MiniMax H3 only: which distillation LoRA to render with, instead of the
   * 20-step base. `'draft'` is 6 steps of throwaway preview for finding prompts
   * and seeds; `'fast'` is lightx2v's 8-step v1.0, good enough to keep. See
   * `H3_TURBO` for what each tier actually sets.
   *
   * `true` is the pre-two-tier spelling of `'draft'` and must keep resolving —
   * it is persisted in form state and baked into saved Director runs. Read it
   * through `h3TurboTier()`, never as truthiness.
   *
   * Ignored by the LTX builders, which have their own distillation LoRA baked in.
   */
  turbo?: boolean | 'draft' | 'fast'
  /**
   * MiniMax H3 reference mode only: ref2va's own Turbo LoRA is installed, so a
   * Turbo render may use it in place of the fl2v one. Set by the form from
   * ComfyUI's model list — a per-machine fact, not a user choice, which is why
   * there is no control for it.
   */
  ref2vTurbo?: boolean
  /**
   * MiniMax H3 only: a light film-grain pass on the finished frames, the same
   * node the image families use. Reintroduces the high-frequency skin texture
   * that flow models smooth away, at roughly 125 ms per frame.
   *
   * **Default ON** — read it as `filmGrain !== false`, never as truthiness, or
   * every render silently loses its grain.
   */
  filmGrain?: boolean
  /**
   * MiniMax H3 only: an RCAS sharpen pass on the finished frames (AMD's
   * contrast-adaptive filter from FSR, via KJNodes).
   *
   * **Default OFF** — read it as `sharpen === true`. Unlike grain it is a taste
   * call rather than a corrective, and it stacks with grain rather than
   * replacing it. See `H3_SHARPEN_STRENGTH`.
   */
  sharpen?: boolean

  /**
   * Hold the finishing passes (interpolation, upscale, sharpen, grain) back for
   * the post-render face swap, which then runs them itself after swapping.
   *
   * Cheaper and better in the same move: the swapper pays for 1x frames at 1x
   * size instead of 1.5x frames at 2.25x the area, and grain lands on the
   * swapped face rather than around it. The cost is that the delivered clip is
   * NOT finished until the swap runs — nothing else re-applies them, which is
   * why the canvas button and the cost chips both say so.
   *
   * H3 only. LTX has no chain to defer: it bakes RIFE into its own graph and
   * has none of the other three.
   */
  swapFaces?: boolean
  /**
   * Seed-hunt candidate: render the half-res first pass and stop. Truncating the
   * graph rather than shrinking it keeps everything upstream identical to a full
   * render, which is what lets the winning seed reproduce the clip that was picked.
   */
  seedHunt?: boolean
  /**
   * MiniMax H3 only: continue a previously rendered clip, so a chain of renders
   * reads as one longer video.
   *
   * The value is the clip's path **relative to ComfyUI's output directory**,
   * subfolders included — the builder appends the ` [output]` annotation that
   * makes core `LoadVideo` read from `output/` instead of `input/`, so nothing
   * has to be copied or re-uploaded per link.
   *
   * The graph freezes the tail of that clip (`H3_CONTEXT_FRAMES` frames and the
   * sound under them) at the head of the new one and trims it back off before
   * saving, so the delivered clip is `H3_CONTEXT_FRAMES` shorter than it was
   * sampled. Callers that show a duration must say which of the two they mean.
   */
  continueFrom?: string
  /**
   * MiniMax H3 `edit` only: the clip to edit, as a LoadVideo value — an
   * input/ filename, or an output/ path with the ` [output]` annotation (how
   * the gallery's "Edit video" hands a clip over without copying it).
   */
  editSource?: string
  /**
   * `vfx` = change something (vfx_edit LoRA), `style` = restyle (style_transfer
   * LoRA), `head` = swap head (head_swap LoRA).
   */
  editKind?: 'vfx' | 'style' | 'head'
  /** Probed off the source by `/api/video/probe`; no probe, no submit. */
  editSourceWidth?: number
  editSourceHeight?: number
  /** The source's length in frames at 24 fps (`floor(duration × 24)`). */
  editSourceFrames?: number
  /** False for a clip with no audio stream — then H3's own soundtrack is kept. */
  editSourceHasAudio?: boolean
  /**
   * How the parts of an edit too big for one render are joined (`h3EditPlan`):
   * `seamless` (default) freezes the previous part's last 39 frames at the head
   * of the next, `fast` renders the parts independently. Anything else reads as
   * seamless.
   */
  editJoin?: 'seamless' | 'fast'
  /**
   * Edit mode's pictures (input/ filenames), sparse by slot like `refImages` —
   * but their own field: a picture left in reference mode must never reach an
   * edit. Ordered and capped by `h3EditPictures`.
   */
  editPictures?: (string | undefined)[]
  /** What each `editPictures` slot is for — ids from `H3_REF_ROLES`. */
  editPictureRoles?: (string | undefined)[]
  /** Swap the face to the Person picture after the edit (default on). */
  editSwapFace?: boolean
  /**
   * The Person picture the form has checked HAS a face. The in-graph swap runs
   * only for exactly this file, so a faceless picture can never fail a render
   * at its last step.
   */
  editFaceChecked?: string
  /** An edited first frame (input/ filename) for the FFP LoRA to carry through the clip. */
  editFirstFrame?: string
  /**
   * Who describes Edit's pictures: 'builtin' (Krea2's Qwen3-VL-4B, a small
   * ComfyUI job) or 'ollama:<model>'. Unset = off. The description is what lets
   * a Person picture change the whole look — the edit LoRA takes outfits and
   * places from a picture, but a person only from words (measured 2026-10-03).
   */
  editDescribeWith?: string
  /** Per `editPictures` slot: the description (editable). '' = emptied by the user. */
  editPictureNotes?: (string | undefined)[]
  /**
   * `exact` (default): the clip is anchored and the edit LoRA keeps the take.
   * `loose`: MiniMax's own reference route — the clip as a half-size reference
   * video, no edit LoRA; faster, follows the motion more loosely, and can take a
   * new person's build. "Change something" only.
   */
  editFollow?: 'exact' | 'loose'
  /**
   * Pixel-budget profile: 'high' (~2MP, 24 GB+), 'medium' (~1.4MP) or 'low'
   * (~1MP, fits 16 GB). Default: high.
   */
  vramMode?: 'high' | 'medium' | 'low'
  /**
   * Megapixels for this one render, overriding the `vramMode` tier's budget. The video helper renders at the model's
   * full canvas (1.0 → 736x1344 portrait), the owner's setup since 2026-10-14; the form never sets it.
   */
  budgetMp?: number
  /**
   * Identity lock: swaps reference conditioning for the 10S face reinforcer and
   * adds the Best-FaceID LoRA. **i2v only** — t2v has no source face, and the
   * builder splices that whole path out for t2v anyway.
   *
   * The reinforcer's phase tagging only means anything to a model patched by
   * that LoRA, so the caller must not offer this unless the LoRA is installed:
   * a missing one is skipped silently by the stack, leaving the node injecting
   * tokens nothing was trained to read.
   */
  faceId?: boolean
  /** Identity strength 0–2. Default 1.0 — what the LoRA was trained for. */
  faceIdStrength?: number
  /** Reinforce the whole subject (auto_face_crop off) instead of just the face. */
  faceIdWholeSubject?: boolean
  /**
   * Add the VBVR motion/camera LoRA right after DMD. The form defaults this on,
   * but it stays opt-in here: the file is an optional 554 MB download and the
   * stack skips a missing LoRA silently, so only a caller that has checked it is
   * installed may switch it on.
   */
  motionLora?: boolean
  /**
   * Up to 4 user LoRA slots appended to the stack after the built-in DMD row.
   * Empty/undefined slot = unused. One strength per slot (video + audio alike).
   */
  lora1?: string
  lora1Strength?: number
  lora2?: string
  lora2Strength?: number
  lora3?: string
  lora3Strength?: number
  lora4?: string
  lora4Strength?: number

  // ── Director mode only ─────────────────────────────────────────────────────
  /**
   * The timeline driving `LTXDirector`. Absent means the builder synthesises a
   * single-segment timeline from `prompt`, which renders exactly like t2v —
   * the node itself bypasses attention masking below two segments.
   */
  timeline?: DirectorTimeline
  /**
   * Prompt-relay boundary hardness. 'sharp' (epsilon 0.001, the paper default)
   * cuts between segments; 'soft' (0.5) blends across them.
   */
  promptBoundary?: 'sharp' | 'soft'
  /** IC-LoRA applied to motion segments. 'None' or a filename from the LoRA dir. */
  motionIcLora?: string
  motionIcLoraStrength?: number
  /**
   * How a keyframe whose aspect differs from the render is made to fit.
   * Defaults to 'crop'. 'maintain aspect ratio' is deliberately not offered —
   * it makes the node silently resize the whole render (see EXACT_RESIZE).
   */
  keyframeFit?: 'crop' | 'pad' | 'pad green' | 'stretch to fit'
  /**
   * Keyframe image used as the FaceID reference. Defaults to the first
   * keyframe; director mode has no single source image to fall back on.
   */
  faceIdImage?: string
}

/** A MiniMax H3 checkpoint pick (`base` = the stock fl2va/ref2va files). */
export type H3CheckpointId = NonNullable<VideoGenerationParams['h3Checkpoint']>

export interface VideoOrientation {
  label: string
  value: string
}

export interface VideoWorkflowDefinition {
  id: string
  name: string
  description: string
  orientations: VideoOrientation[]
  defaultParams: Partial<VideoGenerationParams>
  buildPrompt(params: VideoGenerationParams): ComfyUIPrompt
}
