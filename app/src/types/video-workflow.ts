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
  /** VRAM profile: 'high' (24 GB+, ~2MP render) or 'low' (16 GB, ~1MP render). Default: high. */
  vramMode?: 'high' | 'low'
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
