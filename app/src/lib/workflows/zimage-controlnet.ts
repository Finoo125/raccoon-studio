import type { ComfyUIPrompt } from '@/types/comfyui'
import type { GenerationParams } from '@/types/workflow'
import { CN_PREPROCESSOR } from './controlnet-preprocessors'

export interface ZImageControlNetRefs {
  /** The family's main KSampler id (its `model` input gets wrapped). */
  ksamplerId: string
  /** VAE source ref — the QwenImageDiffsynthControlnet patch needs a vae. */
  vae: [string, number]
}

/**
 * Z-Image Turbo's Fun Union ControlNet filename (installer drops it in
 * models/model_patches/). The 8-step distilled 2601 build preserves Turbo's
 * 8-step speed and adds scribble support. Imported by GenerationForm's
 * availability probe so the name can never drift between download and lookup.
 */
export const FUN_MODEL = 'Z-Image-Turbo-Fun-Controlnet-Union-2.1-2601-8steps.safetensors'

/**
 * Inserts the Z-Image Fun Union ControlNet when `params.controlNet` is set.
 * Unlike the SDXL path (which patches conditioning), this patches the MODEL via
 * ModelPatchLoader -> QwenImageDiffsynthControlnet, reading the KSampler's
 * current model so it composes with the LoRA tail + img2img. Main pass only —
 * hires-fix/detailer keep the base model. Mutates `wf`; no-op when absent.
 */
export function appendZImageControlNet(
  wf: ComfyUIPrompt,
  params: GenerationParams,
  refs: ZImageControlNetRefs,
): void {
  const cn = params.controlNet
  if (!cn) return
  const { ksamplerId, vae } = refs
  const ksampler = wf[ksamplerId]

  wf['zcn:image'] = { class_type: 'LoadImage', inputs: { image: cn.image, upload: 'image' } }
  wf['zcn:pre'] = { class_type: CN_PREPROCESSOR[cn.mode], inputs: { image: ['zcn:image', 0], resolution: 1024 } }
  wf['zcn:patch'] = { class_type: 'ModelPatchLoader', inputs: { name: FUN_MODEL } }
  wf['zcn:apply'] = {
    class_type: 'QwenImageDiffsynthControlnet',
    inputs: {
      model: ksampler.inputs.model,
      model_patch: ['zcn:patch', 0],
      vae,
      image: ['zcn:pre', 0],
      strength: cn.strength ?? 0.8,
    },
  }
  ksampler.inputs.model = ['zcn:apply', 0]
}
