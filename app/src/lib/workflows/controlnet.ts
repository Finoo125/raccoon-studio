import type { ComfyUIPrompt } from '@/types/comfyui'
import type { GenerationParams } from '@/types/workflow'
import { CN_PREPROCESSOR, type ControlNetMode } from './controlnet-preprocessors'

export interface ControlNetRefs {
  /** The family's main KSampler id (its positive/negative get rewired). */
  ksamplerId: string
  /** VAE source ref (ControlNetApplyAdvanced needs a vae for SDXL union). */
  vae: [string, number]
}

/** Local filename of the SDXL union ControlNet model (placed by the installer). */
const UNION_MODEL = 'controlnet-union-sdxl-promax.safetensors'

/**
 * Per-mode xinsir union `type` string (SDXL union model only). Preprocessor
 * class names live in the shared CN_PREPROCESSOR map.
 */
const UNION_TYPE: Record<ControlNetMode, string> = {
  pose: 'openpose',
  depth: 'depth',
  canny: 'canny/lineart/anime_lineart/mlsd',
  scribble: 'hed/pidi/scribble/ted',
}

/**
 * Inserts a single ControlNet branch when `params.controlNet` is set: loads the
 * reference image, auto-preprocesses it for the chosen mode, loads the union
 * ControlNet, sets its union type, and applies it to the KSampler's current
 * positive/negative conditioning (read off the sampler so it composes with the
 * LoRA/clip-skip tail and with img2img). Mutates `wf`; no-op when absent.
 *
 * Applies to the main pass only — hires-fix/detailer keep the base conditioning.
 */
export function appendControlNet(wf: ComfyUIPrompt, params: GenerationParams, refs: ControlNetRefs): void {
  const cn = params.controlNet
  if (!cn) return
  const { ksamplerId, vae } = refs
  const preprocessor = CN_PREPROCESSOR[cn.mode]
  const unionType = UNION_TYPE[cn.mode]

  wf['cn:image'] = { class_type: 'LoadImage', inputs: { image: cn.image, upload: 'image' } }
  wf['cn:pre'] = { class_type: preprocessor, inputs: { image: ['cn:image', 0], resolution: 1024 } }
  wf['cn:load'] = { class_type: 'ControlNetLoader', inputs: { control_net_name: UNION_MODEL } }
  wf['cn:type'] = { class_type: 'SetUnionControlNetType', inputs: { control_net: ['cn:load', 0], type: unionType } }

  const ksampler = wf[ksamplerId]
  wf['cn:apply'] = {
    class_type: 'ControlNetApplyAdvanced',
    inputs: {
      positive: ksampler.inputs.positive,
      negative: ksampler.inputs.negative,
      control_net: ['cn:type', 0],
      image: ['cn:pre', 0],
      vae,
      strength: cn.strength ?? 0.8,
      start_percent: cn.start ?? 0,
      end_percent: cn.end ?? 1,
    },
  }
  ksampler.inputs.positive = ['cn:apply', 0]
  ksampler.inputs.negative = ['cn:apply', 1]
}
