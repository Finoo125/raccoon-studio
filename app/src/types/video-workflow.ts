import type { ComfyUIPrompt } from './comfyui'

export interface VideoGenerationParams {
  /** → RaccoonVideoPrompt.confirmed_prompt (required, non-empty; ComfyUI rejects empty). */
  prompt: string
  mode: 't2v' | 'i2v'
  /** t2v framing key: 'portrait' | 'landscape' | 'square'. */
  orientation?: string
  /** i2v: filename already uploaded to ComfyUI's input dir. */
  inputImage?: string
  /** i2v: source image pixel size — drives rm_w/rm_h (aspect-preserving ~2MP, /32). */
  inputImageWidth?: number
  inputImageHeight?: number
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
  /** RIFE frame interpolation on the final clip; false splices it out. Default: on (baked). */
  rife?: boolean
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
