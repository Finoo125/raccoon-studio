import { describe, it, expect } from 'vitest'
import type { ComfyUIPrompt } from '@/types/comfyui'
import type { GenerationParams } from '@/types/workflow'
import { appendControlNet } from './controlnet'

// Minimal stand-in: a KSampler reading positive/negative conditioning + a vae.
function baseGraph(): ComfyUIPrompt {
  return {
    ks: { class_type: 'KSampler', inputs: { positive: ['pos', 0], negative: ['neg', 0], model: ['m', 0] } },
    pos: { class_type: 'CLIPTextEncode', inputs: { text: 'a' } },
    neg: { class_type: 'CLIPTextEncode', inputs: { text: 'b' } },
    vae: { class_type: 'VAELoader', inputs: {} },
  } as unknown as ComfyUIPrompt
}
const refs = { ksamplerId: 'ks', vae: ['vae', 0] as [string, number] }
const p = (over: Partial<GenerationParams>): GenerationParams =>
  ({ prompt: 'x', width: 512, height: 512, seed: 1, ...over } as GenerationParams)

describe('appendControlNet', () => {
  it('is a no-op without controlNet', () => {
    const wf = baseGraph()
    appendControlNet(wf, p({}), refs)
    expect(wf['cn:apply']).toBeUndefined()
    expect(wf.ks.inputs.positive).toEqual(['pos', 0])
  })

  it('loads the reference, preprocesses, and rewires positive/negative', () => {
    const wf = baseGraph()
    appendControlNet(wf, p({ controlNet: { mode: 'pose', image: 'ref.png', strength: 0.8 } }), refs)
    expect(wf['cn:image'].inputs.image).toBe('ref.png')
    expect(wf['cn:pre'].class_type).toBe('OpenposePreprocessor')
    expect(wf['cn:pre'].inputs.image).toEqual(['cn:image', 0])
    expect(wf['cn:type'].inputs.type).toBe('openpose')
    expect(wf['cn:apply'].inputs.control_net).toEqual(['cn:type', 0])
    expect(wf['cn:apply'].inputs.image).toEqual(['cn:pre', 0])
    expect(wf['cn:apply'].inputs.positive).toEqual(['pos', 0])
    expect(wf['cn:apply'].inputs.negative).toEqual(['neg', 0])
    expect(wf['cn:apply'].inputs.vae).toEqual(['vae', 0])
    expect(wf['cn:apply'].inputs.strength).toBe(0.8)
    expect(wf.ks.inputs.positive).toEqual(['cn:apply', 0])
    expect(wf.ks.inputs.negative).toEqual(['cn:apply', 1])
  })

  it('maps each mode to its preprocessor + union type', () => {
    const cases: { mode: 'depth' | 'canny' | 'scribble'; pre: string; type: string }[] = [
      { mode: 'depth', pre: 'DepthAnythingV2Preprocessor', type: 'depth' },
      { mode: 'canny', pre: 'CannyEdgePreprocessor', type: 'canny/lineart/anime_lineart/mlsd' },
      { mode: 'scribble', pre: 'ScribblePreprocessor', type: 'hed/pidi/scribble/ted' },
    ]
    for (const c of cases) {
      const wf = baseGraph()
      appendControlNet(wf, p({ controlNet: { mode: c.mode, image: 'r.png', strength: 0.5 } }), refs)
      expect(wf['cn:pre'].class_type).toBe(c.pre)
      expect(wf['cn:type'].inputs.type).toBe(c.type)
    }
  })

  it('defaults strength to 0.8 and start/end to 0/1', () => {
    const wf = baseGraph()
    appendControlNet(wf, p({ controlNet: { mode: 'canny', image: 'r.png', strength: undefined as unknown as number } }), refs)
    expect(wf['cn:apply'].inputs.strength).toBe(0.8)
    expect(wf['cn:apply'].inputs.start_percent).toBe(0)
    expect(wf['cn:apply'].inputs.end_percent).toBe(1)
  })
})
