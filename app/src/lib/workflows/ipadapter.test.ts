import { describe, it, expect } from 'vitest'
import type { ComfyUIPrompt } from '@/types/comfyui'
import type { GenerationParams } from '@/types/workflow'
import { appendIpAdapter } from './ipadapter'

function baseGraph(): ComfyUIPrompt {
  return {
    ks: { class_type: 'KSampler', inputs: { model: ['m', 0], positive: ['pos', 0] } },
    m: { class_type: 'CheckpointLoaderSimple', inputs: {} },
  } as unknown as ComfyUIPrompt
}
const refs = { ksamplerId: 'ks' }
const p = (over: Partial<GenerationParams>): GenerationParams =>
  ({ prompt: 'x', width: 512, height: 512, seed: 1, ...over } as GenerationParams)

describe('appendIpAdapter', () => {
  it('is a no-op without ipAdapter', () => {
    const wf = baseGraph()
    appendIpAdapter(wf, p({}), refs)
    expect(wf['ip:apply']).toBeUndefined()
    expect(wf.ks.inputs.model).toEqual(['m', 0])
  })

  it('loads the reference and wraps the KSampler model', () => {
    const wf = baseGraph()
    appendIpAdapter(wf, p({ ipAdapter: { image: 'style.png', weight: 0.6 } }), refs)
    expect(wf['ip:image'].inputs.image).toBe('style.png')
    expect(wf['ip:loader'].class_type).toBe('IPAdapterUnifiedLoader')
    expect(wf['ip:loader'].inputs.model).toEqual(['m', 0])
    expect(wf['ip:apply'].class_type).toBe('IPAdapterAdvanced')
    expect(wf['ip:apply'].inputs.model).toEqual(['ip:loader', 0])
    expect(wf['ip:apply'].inputs.ipadapter).toEqual(['ip:loader', 1])
    expect(wf['ip:apply'].inputs.image).toEqual(['ip:image', 0])
    expect(wf['ip:apply'].inputs.weight).toBe(0.6)
    expect(wf.ks.inputs.model).toEqual(['ip:apply', 0])
  })

  it('defaults weight to 0.7', () => {
    const wf = baseGraph()
    appendIpAdapter(wf, p({ ipAdapter: { image: 's.png', weight: undefined as unknown as number } }), refs)
    expect(wf['ip:apply'].inputs.weight).toBe(0.7)
  })
})
