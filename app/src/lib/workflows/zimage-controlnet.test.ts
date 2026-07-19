import { describe, it, expect } from 'vitest'
import type { ComfyUIPrompt } from '@/types/comfyui'
import type { GenerationParams } from '@/types/workflow'
import { appendZImageControlNet, FUN_MODEL } from './zimage-controlnet'

// Minimal stand-in: a KSampler reading a model + a vae loader.
function baseGraph(): ComfyUIPrompt {
  return {
    ks: { class_type: 'KSampler', inputs: { model: ['msaf', 0], latent_image: ['lat', 0] } },
    msaf: { class_type: 'ModelSamplingAuraFlow', inputs: {} },
    vae: { class_type: 'VAELoader', inputs: {} },
  } as unknown as ComfyUIPrompt
}
const refs = { ksamplerId: 'ks', vae: ['vae', 0] as [string, number] }
const p = (over: Partial<GenerationParams>): GenerationParams =>
  ({ prompt: 'x', width: 832, height: 1216, seed: 1, ...over } as GenerationParams)

describe('appendZImageControlNet', () => {
  it('is a no-op without controlNet', () => {
    const wf = baseGraph()
    appendZImageControlNet(wf, p({}), refs)
    expect(wf['zcn:apply']).toBeUndefined()
    expect(wf.ks.inputs.model).toEqual(['msaf', 0])
  })

  it('loads + preprocesses the reference and patches the KSampler model', () => {
    const wf = baseGraph()
    appendZImageControlNet(wf, p({ controlNet: { mode: 'pose', image: 'ref.png', strength: 0.8 } }), refs)
    expect(wf['zcn:image'].inputs.image).toBe('ref.png')
    expect(wf['zcn:pre'].class_type).toBe('OpenposePreprocessor')
    expect(wf['zcn:pre'].inputs.image).toEqual(['zcn:image', 0])
    expect(wf['zcn:patch'].class_type).toBe('ModelPatchLoader')
    expect(wf['zcn:patch'].inputs.name).toBe(FUN_MODEL)
    expect(wf['zcn:apply'].class_type).toBe('QwenImageDiffsynthControlnet')
    expect(wf['zcn:apply'].inputs.model).toEqual(['msaf', 0])
    expect(wf['zcn:apply'].inputs.model_patch).toEqual(['zcn:patch', 0])
    expect(wf['zcn:apply'].inputs.vae).toEqual(['vae', 0])
    expect(wf['zcn:apply'].inputs.image).toEqual(['zcn:pre', 0])
    expect(wf['zcn:apply'].inputs.strength).toBe(0.8)
    expect(wf.ks.inputs.model).toEqual(['zcn:apply', 0])
  })

  it('maps each mode to its preprocessor', () => {
    const cases: { mode: 'depth' | 'canny' | 'scribble'; pre: string }[] = [
      { mode: 'depth', pre: 'DepthAnythingV2Preprocessor' },
      { mode: 'canny', pre: 'CannyEdgePreprocessor' },
      { mode: 'scribble', pre: 'ScribblePreprocessor' },
    ]
    for (const c of cases) {
      const wf = baseGraph()
      appendZImageControlNet(wf, p({ controlNet: { mode: c.mode, image: 'r.png', strength: 0.5 } }), refs)
      expect(wf['zcn:pre'].class_type).toBe(c.pre)
    }
  })

  it('defaults strength to 0.8', () => {
    const wf = baseGraph()
    appendZImageControlNet(wf, p({ controlNet: { mode: 'canny', image: 'r.png', strength: undefined as unknown as number } }), refs)
    expect(wf['zcn:apply'].inputs.strength).toBe(0.8)
  })
})
