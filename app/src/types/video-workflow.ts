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
   * MiniMax H3 only: Turbo LoRA at a reduced step count instead of the 20-step
   * base. Presented as "Draft mode" — it is for finding prompts and seeds, not
   * for clips you keep. Ignored by the LTX builders, which have their own
   * distillation LoRA baked in.
   */
  turbo?: boolean
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
