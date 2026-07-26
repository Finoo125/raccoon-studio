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
      // IPAdapterAdvanced marks these "required", so ComfyUI 400s the whole
      // prompt if they're absent — widget defaults are not filled in server-side.
      weight_type: 'linear',
      combine_embeds: 'concat',
      start_at: 0.0,
      end_at: 1.0,
      embeds_scaling: 'V only',
    },
  }
  ksampler.inputs.model = ['ip:apply', 0]
}
