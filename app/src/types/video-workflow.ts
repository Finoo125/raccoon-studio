import type { ComfyUIPrompt } from './comfyui'
import type { DirectorTimeline } from '@/lib/workflows/director-timeline'

export interface VideoGenerationParams {
  /** → RaccoonVideoPrompt.confirmed_prompt (required, non-empty; ComfyUI rejects empty). */
  prompt: string
  /**
   * `director` is only ever handled by the ltx23-director workflow; the ltx23
   * builder never receives it (the two are separate `VideoWorkflowDefinition`s
   * selected by id).
   */
  mode: 't2v' | 'i2v' | 'ref2v' | 'director'
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
   * Seed-hunt candidate: render the half-res first pass and stop. Truncating the
   * graph rather than shrinking it keeps everything upstream identical to a full
   * render, which is what lets the winning seed reproduce the clip that was picked.
   */
  seedHunt?: boolean
  /**
   * Pixel-budget profile: 'high' (~2MP, 24 GB+), 'medium' (~1.4MP) or 'low'
   * (~1MP, fits 16 GB). Default: high.
   */
  vramMode?: 'high' | 'medium' | 'low'
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
