import type { ComfyUIPrompt } from './comfyui'

export interface AspectRatio {
  label: string
  width: number
  height: number
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
  steps?: number
  cfg?: number
  lora1?: string
  lora1Strength?: number
  lora2?: string
  lora2Strength?: number
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
  promptEnhancer?: boolean
  inputImage?: string
  /** Enable ReActor face swap, using `inputImage` as the source face. */
  faceSwap?: boolean
  /**
   * ReActor swap model filename. `inswapper_128.onnx` (default) is the classic
   * 128px swapper paired with a GPEN face-boost; the `hyperswap_1*_256` variants
   * are FaceFusion's newer 256px swappers for more detail and likeness (ReActor
   * runs them without the boost stage; 1c generally has the strongest identity
   * similarity). Absent counts as inswapper.
   */
  faceSwapModel?: 'inswapper_128.onnx' | 'hyperswap_1a_256.onnx' | 'hyperswap_1b_256.onnx' | 'hyperswap_1c_256.onnx'
  /** Swap via the vendored pixel-boost node (512-1024px effective swap
   *  resolution) instead of ReActorFaceSwap. Off by default. */
  faceSwapPixelBoost?: boolean
  /** Pixel-boost effective resolution; defaults to 512x512. */
  faceSwapPixelBoostSize?: '512x512' | '768x768' | '1024x1024'
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
  supportsNegativePrompt: boolean
  supportsLoRA: boolean
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
   *  'sdxl-union' = ControlNetApplyAdvanced; 'zimage-fun' = model-patch path. */
  controlNetKind?: 'sdxl-union' | 'zimage-fun'
  /**
   * How a selected Aria/Patreon model is applied:
   * - 'lora'       → applied to a LoraLoader node.
   * - 'checkpoint' → replaces CheckpointLoaderSimple.ckpt_name (SDXL family).
   * - 'unet'       → replaces UNETLoader.unet_name (diffusion families:
   *                  z-image/ernie/anima). File lives in diffusion_models/.
   *                  No strength (full model swap, not an additive layer).
   */
  ariaModelKind: 'checkpoint' | 'lora' | 'unet'
  aspectRatios: AspectRatio[]
  defaultParams: Partial<GenerationParams>
  buildPrompt(params: GenerationParams): ComfyUIPrompt
}
