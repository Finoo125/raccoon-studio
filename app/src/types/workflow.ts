import type { ComfyUIPrompt } from './comfyui'
import type { LoraFamily } from '@/lib/models/lora-family'

export interface AspectRatio {
  label: string
  width: number
  height: number
}

export interface LoraParam {
  name: string
  strength?: number
}

export interface GenerationParams {
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  seed: number
  /** Images generated in parallel within a single job (latent batch_size), max 4. */
  batchSize?: number
  /** Number of separate jobs to queue, each producing `batchSize` images. */
  jobCount?: number
  /**
   * Expert Mode: hand the sampler knobs below to the user. Off (absent/false)
   * ⇒ `steps`, `cfg`, `sampler` and `scheduler` are ignored entirely and every
   * family renders on its own tuned budget. See `expert-sampler.ts`.
   */
  expertMode?: boolean
  /** Main-pass step count. Expert Mode only. */
  steps?: number
  /** Main-pass CFG. Expert Mode only. Distilled families are trained at 1. */
  cfg?: number
  /** Main-pass ComfyUI `sampler_name`. Expert Mode only. */
  sampler?: string
  /** Main-pass ComfyUI `scheduler`. Expert Mode only. */
  scheduler?: string
  /** Ordered LoRA stack. The form starts with two rows and can append any number. */
  loras?: LoraParam[]
  /** Selected Patreon/Aria model (applied to the workflow's model/LoRA node). */
  ariaModel?: string
  ariaModelStrength?: number
  /**
   * SDXL family only: filename of a dedicated VAE to decode through instead of
   * the checkpoint's baked VAE. Set by the form when the fp16-fix SDXL VAE is
   * installed — it cures the washed-out / desaturated colors some SDXL
   * checkpoints (notably Illustrious) produce with their own baked fp16 VAE.
   * Absent → keep the checkpoint VAE (so nothing breaks when it isn't present).
   */
  sdxlVae?: string
  /**
   * Krea2 family only: filename of the TextFusion refusal-reduction LoRA,
   * applied at a fixed strength of 1. Injected by the form at submit time, and
   * only once ComfyUI actually reports the file — an unknown `lora_name` is
   * rejected with `value_not_in_list`, which surfaces as a bare "Generation
   * failed". Absent ⇒ the loader node is never emitted.
   */
  krea2RefusalLora?: string
  /**
   * Krea2 family only: which uncensor patch the NSFW section selected.
   * 'patch' (the default, and what shipped before this choice existed) = the
   * small refusal-reduction LoRA; 'kroma' = the full Kroma fine-tune instead;
   * 'off' = stock model. Only the form reads this — it decides which of the two
   * filenames below to inject, and they are mutually exclusive by construction.
   */
  krea2Nsfw?: 'off' | 'patch' | 'kroma'
  /** Krea2 family only: filename of the Kroma fine-tune LoRA. Same
   *  form-confirms-then-injects rule as `krea2RefusalLora`. */
  krea2KromaLora?: string
  /** Krea2 family only: Kroma strength. 1 (default) is upstream's recommendation;
   *  lower blends it back toward stock Krea2. 0 omits the LoRA entirely. */
  krea2KromaStrength?: number
  /** Krea2 family only: filename of the projector-scale LoRA. Same
   *  form-confirms-then-injects rule as `krea2RefusalLora`. */
  krea2ProjectorLora?: string
  /**
   * Krea2 family only: projector-scale strength — how hard the model is pushed
   * to follow the prompt. Scales on a different axis than CFG: 0.01 = +1×,
   * 0.05 (the default) = +5×, 0.1 = +10×. 0 omits the LoRA entirely.
   */
  krea2ProjectorStrength?: number
  promptEnhancer?: boolean
  /**
   * Qwen-Image 2.1 only: filename of the prompt-enhancer model — a separate
   * 9.5 GB Qwen3.5-9B, not the loaded text encoder as with Krea2. Same
   * form-confirms-then-injects rule as `krea2RefusalLora`: set only once ComfyUI
   * lists the file, so a toggle left on in a saved session cannot fail the job.
   * Absent ⇒ no enhancer, whatever `promptEnhancer` says.
   */
  qwen21Enhancer?: string
  /**
   * Qwen-Image 2.1 Edit preset only: ComfyUI input-dir filenames of the
   * pictures, in order — picture 1 is the one being edited, 2-4 references.
   * Seen by the text encoder, spliced in as VAE latents; the canvas follows
   * picture 1. Every other preset ignores it, so pictures left in the form
   * after an edit never reach a text-to-image render. Gap-free: the form fills
   * slots in order.
   */
  qwenReferences?: string[]
  /** Qwen-Image 2.1 Edit only: the preset instruction in use — BFS head swap
   *  (pictures 1 + 2) or a character sheet (picture 1). The form fills the
   *  instruction text; the builder adds the chip's LoRA or canvas. */
  editChip?: 'bfs' | 'sheet'
  /** Which BFS head-swap LoRA the 'bfs' chip loads. Absent ⇒ 'alternative'. */
  bfsVariant?: 'alternative' | 'v1.1'
  inputImage?: string
  /** Enable ReActor face swap, using `inputImage` as the source face. */
  faceSwap?: boolean
  /**
   * Swap model filename. `inswapper_128.onnx` (default) is the classic
   * 128px swapper paired with a GPEN face-boost; the `hyperswap_1*_256` variants
   * are FaceFusion's newer 256px swappers for more detail and likeness (ReActor
   * runs them without the boost stage; 1c generally has the strongest identity
   * similarity). Absent counts as inswapper.
   *
   * `alphaface_256.onnx` is FaceFusion 3.9.0's swapper and is **pixel-boost
   * only** — ReActor has no branch for it (`reactor_swapper.py` resolves any
   * name without "hyperswap" in it against `models/insightface/`), so picking it
   * forces the vendored node regardless of `faceSwapPixelBoost`. See
   * `face-swap.ts`.
   */
  faceSwapModel?: 'inswapper_128.onnx' | 'hyperswap_1a_256.onnx' | 'hyperswap_1b_256.onnx' | 'hyperswap_1c_256.onnx' | 'alphaface_256.onnx'
  /** Swap via the vendored pixel-boost node (512-1024px effective swap
   *  resolution) instead of ReActorFaceSwap. Off by default. */
  faceSwapPixelBoost?: boolean
  /** Pixel-boost effective resolution; defaults to 512x512. */
  faceSwapPixelBoostSize?: '512x512' | '768x768' | '1024x1024'
  /**
   * Identity strength, 0..1, neutral at 0.5 (the default, and a no-op). Blends
   * the source face's arcface latent toward the generated face below 0.5 and
   * away from it above — see `balance_embedding` in the vendored pack. Pixel-
   * boost path only; ReActor has no equivalent.
   */
  faceSwapIdentity?: number
  /**
   * Where the face-swap source face comes from:
   * - 'upload' (default) → a photo uploaded to ComfyUI's input dir (`inputImage`).
   * - 'model'            → a saved ReActor face model (`faceModel`), built in the
   *                        Tools tab from one or more reference photos.
   * Absent counts as 'upload'.
   */
  faceSwapSource?: 'upload' | 'model'
  /** Saved ReActor face-model filename (e.g. `alice.safetensors`) when
   *  `faceSwapSource === 'model'`. Lives in ComfyUI's `models/reactor/faces/`. */
  faceModel?: string
  /** Run the final upscale stage (net 1.5×). On by default; absent counts as on. */
  upscale?: boolean
  /** Run the face detailer stage. On by default; absent counts as on. */
  detailer?: boolean
  /**
   * Decode the latent in tiles instead of all at once. VAE decode is the peak-VRAM
   * moment of a render — it briefly needs more than sampling does, which is why a
   * card that samples fine still OOMs on the last step, and why hi-res fix (which
   * decodes at the *upscaled* size) is usually what tips it over. Tiling trades a
   * few percent of speed, and a small seam risk, for a large cut in that peak.
   * Off by default: it is a low-VRAM remedy, not a free win.
   */
  tiledVaeDecode?: boolean
  /** Tile edge in px. 512 (default) suits ~8 GB cards; 384 for ~6 GB; 768 barely
   *  helps. Below `overlap * 4` ComfyUI shrinks the overlap to match. */
  tiledVaeTileSize?: 384 | 512 | 768
  // ── Base-image modes (img2img / inpaint / outpaint) ──────────────────────────
  /** ComfyUI input-dir filename of the source image. Absent ⇒ txt2img. Distinct
   *  from `inputImage` (the ReActor face-swap source). */
  baseImage?: string
  /** Which base-image mode is active (only meaningful when `baseImage` is set). */
  editMode?: 'img2img' | 'inpaint' | 'outpaint'
  /** img2img/inpaint denoise strength (0.2–1.0). Default 0.65; outpaint 1.0. */
  denoise?: number
  /** ComfyUI input-dir filename of the painted mask (inpaint). White = redraw. */
  maskImage?: string
  /** Outpaint pad amounts in px per side + feather. */
  outpaint?: { left: number; top: number; right: number; bottom: number; feather: number }
  // ── Reference guidance (ControlNet / IP-Adapter) — SDXL family only ───────────
  /** One active ControlNet: copy pose/depth/edges/sketch of a reference photo. */
  controlNet?: {
    mode: 'pose' | 'depth' | 'canny' | 'scribble'
    /** ComfyUI input-dir filename of the reference photo (auto-preprocessed). */
    image: string
    /** Conditioning strength 0.1–1.0 (default 0.8). */
    strength: number
    /** Apply start %, default 0.0. */
    start?: number
    /** Apply end %, default 1.0. */
    end?: number
  }
  /** IP-Adapter style/subject reference ("make it look like this"). */
  ipAdapter?: {
    /** ComfyUI input-dir filename of the reference image. */
    image: string
    /** Reference weight 0.1–1.0 (default 0.7). */
    weight: number
  }
}

export interface WorkflowDefinition {
  id: string
  name: string
  description: string
  /**
   * Filename of the base model this preset loads when no Aria model is chosen —
   * a checkpoint for the SDXL family, a diffusion model for the UNET families.
   * Drives the "is this preset usable" state in the form, so it is always read
   * off the same value the builder writes into the graph rather than repeated
   * as a second literal.
   */
  baseModel: string
  supportsNegativePrompt: boolean
  supportsLoRA: boolean
  /**
   * Base-model architecture this workflow's LoRAs must match. The picker reads
   * each installed LoRA's safetensors header and hides the ones belonging to a
   * different family (an SDXL LoRA cannot load on Z-Image). SDXL/Pony/Illustrious
   * share one value — they are all literally SDXL, so their LoRAs interchange.
   * Omit to show every LoRA unfiltered.
   */
  loraFamily?: LoraFamily
  supportsPromptEnhancer: boolean
  supportsInputImage: boolean
  /** Whether the workflow has an optional final upscale stage. */
  supportsUpscale: boolean
  /** Whether the workflow supports the optional face detailer stage. */
  supportsDetailer: boolean
  /** Whether the workflow supports base-image modes (img2img/inpaint/outpaint). */
  supportsImg2Img: boolean
  /** Whether the workflow supports ControlNet (SDXL family only). */
  supportsControlNet: boolean
  /** Whether the workflow supports IP-Adapter reference (SDXL family only). */
  supportsIpAdapter: boolean
  /** Which ControlNet backend this workflow uses (only when supportsControlNet).
   *  'sdxl-union' = ControlNetApplyAdvanced; 'zimage-fun' / 'qwen21-fun' = the
   *  model-patch path, each with its own Fun Union file. */
  controlNetKind?: 'sdxl-union' | 'zimage-fun' | 'qwen21-fun'
  /**
   * How a selected Aria/Patreon model is applied:
   * - 'lora'       → applied to a LoraLoader node.
   * - 'checkpoint' → replaces CheckpointLoaderSimple.ckpt_name (SDXL family).
   * - 'unet'       → replaces UNETLoader.unet_name (diffusion families:
   *                  z-image/ernie/anima). File lives in diffusion_models/.
   *                  No strength (full model swap, not an additive layer).
   */
  ariaModelKind: 'checkpoint' | 'lora' | 'unet'
  /**
   * The preset samples an explicit distilled sigma list (Qwen-Image 2.1 Turbo),
   * so Expert Mode's steps and scheduler do not apply — only sampler and CFG.
   */
  distilledSchedule?: boolean
  /**
   * The preset edits pictures (Qwen-Image 2.1 Edit): how many picture slots the
   * form shows in place of the base-image panel. It also hides the aspect
   * ratios and the batch size — the canvas follows picture 1, one per job.
   */
  referenceSlots?: number
  /**
   * Tag models (Pony, Illustrious, Anima) want comma-separated Danbooru tags;
   * absent = plain sentences. Read by the Prompt Helper through `promptStyleOf`.
   */
  promptStyle?: 'tags'
  aspectRatios: AspectRatio[]
  defaultParams: Partial<GenerationParams>
  buildPrompt(params: GenerationParams): ComfyUIPrompt
}
