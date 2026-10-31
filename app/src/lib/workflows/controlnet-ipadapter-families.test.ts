import { describe, it, expect } from 'vitest'
import { workflows } from './index'
import type { GenerationParams } from '@/types/workflow'
import { QWEN21_FUN_MODEL } from './zimage-controlnet'

const base = (over: Partial<GenerationParams>): GenerationParams =>
  ({ prompt: 'x', width: 832, height: 1216, seed: 1, ...over } as GenerationParams)

const sdxlFamily = workflows.filter((w) => w.controlNetKind === 'sdxl-union')
const zimage = workflows.filter((w) => w.controlNetKind === 'zimage-fun')
const qwen21 = workflows.filter((w) => w.controlNetKind === 'qwen21-fun')
const others = workflows.filter((w) => !w.supportsControlNet)

describe('ControlNet/IP-Adapter wiring per family', () => {
  it('controlNetKind partitions the families', () => {
    expect(sdxlFamily.map((w) => w.id).sort()).toEqual(['illustrious', 'pony', 'sdxl'])
    expect(zimage.map((w) => w.id).sort()).toEqual(['z-image-turbo'])
    // Krea2 sits here because no Krea2 ControlNet model has been published.
    expect(qwen21.map((w) => w.id).sort()).toEqual(['qwen21', 'qwen21-turbo'])
    expect(others.map((w) => w.id).sort()).toEqual([
      'anima', 'anima-turbo', 'ernie-turbo', 'krea2-raw', 'krea2-turbo',
      // The Qwen Edit preset: its canvas is picture 1, ControlNet does not apply.
      'qwen21-edit',
    ])
  })

  for (const wf of sdxlFamily) {
    it(`${wf.id}: ControlNet rewires the sampler conditioning`, () => {
      const g = wf.buildPrompt(base({ controlNet: { mode: 'pose', image: 'r.png', strength: 0.8 } }))
      expect(g['cn:apply'].class_type).toBe('ControlNetApplyAdvanced')
      expect(g['3'].inputs.positive).toEqual(['cn:apply', 0])
      expect(g['3'].inputs.negative).toEqual(['cn:apply', 1])
    })

    it(`${wf.id}: IP-Adapter wraps the sampler model`, () => {
      const g = wf.buildPrompt(base({ ipAdapter: { image: 's.png', weight: 0.7 } }))
      expect(g['ip:apply'].class_type).toBe('IPAdapterAdvanced')
      expect(g['3'].inputs.model).toEqual(['ip:apply', 0])
    })

    it(`${wf.id}: txt2img leaves no cn:/ip: nodes`, () => {
      const g = wf.buildPrompt(base({}))
      expect(g['cn:apply']).toBeUndefined()
      expect(g['ip:apply']).toBeUndefined()
    })
  }

  for (const wf of zimage) {
    it(`${wf.id}: ControlNet patches the sampler model (Fun Union path)`, () => {
      const g = wf.buildPrompt(base({ controlNet: { mode: 'depth', image: 'r.png', strength: 0.6 } }))
      expect(g['zcn:apply'].class_type).toBe('QwenImageDiffsynthControlnet')
      expect(g['zcn:patch'].class_type).toBe('ModelPatchLoader')
      expect(g['57:3'].inputs.model).toEqual(['zcn:apply', 0])
      expect(g['cn:apply']).toBeUndefined() // not the SDXL conditioning path
    })

    it(`${wf.id}: img2img + ControlNet compose on the sampler`, () => {
      const g = wf.buildPrompt(base({
        baseImage: 'b.png', editMode: 'img2img', denoise: 0.6,
        controlNet: { mode: 'canny', image: 'r.png', strength: 0.5 },
      }))
      expect(g['57:3'].inputs.latent_image).toEqual(['i2i:encode', 0])
      expect(g['57:3'].inputs.model).toEqual(['zcn:apply', 0])
    })

    it(`${wf.id}: ignores IP-Adapter (SDXL-only)`, () => {
      const g = wf.buildPrompt(base({ ipAdapter: { image: 's.png', weight: 0.7 } }))
      expect(g['ip:apply']).toBeUndefined()
    })

    it(`${wf.id}: txt2img leaves no zcn: nodes`, () => {
      const g = wf.buildPrompt(base({}))
      expect(g['zcn:apply']).toBeUndefined()
    })
  }

  for (const wf of qwen21) {
    it(`${wf.id}: ControlNet patches the main pass with the Qwen 2.1 Fun Union model`, () => {
      const g = wf.buildPrompt(base({ controlNet: { mode: 'depth', image: 'r.png', strength: 0.6 } }))
      expect(g['zcn:patch'].inputs.name).toBe(QWEN21_FUN_MODEL)
      expect(g['zcn:apply'].class_type).toBe('QwenImageDiffsynthControlnet')
      expect(g['q:sampler'].inputs.model).toEqual(['zcn:apply', 0])
      // Main pass only — the HiRes fix keeps the plain model, like Z-Image.
      expect(g['hires:sample'].inputs.model).toEqual(['q:loras', 0])
    })

    it(`${wf.id}: txt2img leaves no zcn: nodes`, () => {
      expect(wf.buildPrompt(base({}))['zcn:apply']).toBeUndefined()
    })
  }

  for (const wf of others) {
    it(`${wf.id}: ignores ControlNet/IP-Adapter params`, () => {
      const g = wf.buildPrompt(base({
        controlNet: { mode: 'pose', image: 'r.png', strength: 0.8 },
        ipAdapter: { image: 's.png', weight: 0.7 },
      }))
      expect(g['cn:apply']).toBeUndefined()
      expect(g['zcn:apply']).toBeUndefined()
      expect(g['ip:apply']).toBeUndefined()
    })
  }
})
