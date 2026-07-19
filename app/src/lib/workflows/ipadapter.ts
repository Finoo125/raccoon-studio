import type { ComfyUIPrompt } from '@/types/comfyui'
import type { GenerationParams } from '@/types/workflow'

export interface IpAdapterRefs {
  /** The family's main KSampler id (its model gets wrapped). */
  ksamplerId: string
}

/**
 * Inserts an IP-Adapter branch when `params.ipAdapter` is set: loads the
 * reference image, resolves the SDXL PLUS adapter + CLIP-vision via the unified
 * loader (off the KSampler's current model, so it composes with the LoRA tail),
 * and wraps the model. Mutates `wf`; no-op when absent. Main pass only.
 */
export function appendIpAdapter(wf: ComfyUIPrompt, params: GenerationParams, refs: IpAdapterRefs): void {
  const ip = params.ipAdapter
  if (!ip) return
  const ksampler = wf[refs.ksamplerId]

  wf['ip:image'] = { class_type: 'LoadImage', inputs: { image: ip.image, upload: 'image' } }
  wf['ip:loader'] = {
    class_type: 'IPAdapterUnifiedLoader',
    inputs: { model: ksampler.inputs.model, preset: 'PLUS (high strength)' },
  }
  wf['ip:apply'] = {
    class_type: 'IPAdapterAdvanced',
    inputs: {
      model: ['ip:loader', 0],
      ipadapter: ['ip:loader', 1],
      image: ['ip:image', 0],
      weight: ip.weight ?? 0.7,
    },
  }
  ksampler.inputs.model = ['ip:apply', 0]
}
