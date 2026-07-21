import { describe, it, expect } from 'vitest'
import { animaWorkflow, animaTurboWorkflow } from './anima'
import type { GenerationParams } from '@/types/workflow'

const base: GenerationParams = {
  prompt: 'a cat',
  width: 832,
  height: 1216,
  seed: 42,
  detailer: false,
}

describe('animaWorkflow.buildPrompt', () => {
  it('runs a latent hires-fix by default (4x-AnimeSharp, net 1.5×, denoise 0.2, 12 steps)', () => {
    const wf = animaWorkflow.buildPrompt(base)
    expect(wf['hires:upscale_model'].inputs.model_name).toBe('4x-AnimeSharp.pth')
    expect(wf['hires:upscale'].inputs.image).toEqual(['60:8', 0])
    expect(wf['hires:scale'].inputs.scale_by).toBeCloseTo(0.375)
    expect(wf['hires:sample'].inputs.denoise).toBe(0.2)
    expect(wf['hires:sample'].inputs.steps).toBe(12)
    expect(wf['hires:sample'].inputs.seed).toBe(42)
    expect(wf['46'].inputs.images).toEqual(['hires:decode', 0])
  })

  it('removes the legacy ESRGAN upscale nodes', () => {
    const wf = animaWorkflow.buildPrompt(base)
    expect(wf['120']).toBeUndefined()
    expect(wf['121']).toBeUndefined()
    expect(wf['122']).toBeUndefined()
  })

  it('drops the hires-fix and saves the decoded image when upscale is off', () => {
    const wf = animaWorkflow.buildPrompt({ ...base, upscale: false })
    expect(wf['hires:upscale']).toBeUndefined()
    expect(wf['hires:sample']).toBeUndefined()
    expect(wf['46'].inputs.images).toEqual(['60:8', 0])
  })

  it('does not apply clip skip (Anima uses a Qwen text encoder, not CLIP)', () => {
    const wf = animaWorkflow.buildPrompt(base)
    expect(wf['clip:skip']).toBeUndefined()
  })

  it('wires the parallel batch into the latent, capped at 4', () => {
    expect(animaWorkflow.buildPrompt(base)['60:28'].inputs.batch_size).toBe(1)
    expect(animaWorkflow.buildPrompt({ ...base, batchSize: 2 })['60:28'].inputs.batch_size).toBe(2)
    expect(animaWorkflow.buildPrompt({ ...base, batchSize: 8 })['60:28'].inputs.batch_size).toBe(4)
  })

  it('seeds the Anima-Aesthetic prompt convention (quality tags, no score_* ladder)', () => {
    expect(animaWorkflow.defaultParams.prompt).toBe('masterpiece, best quality, safe, ')
    expect(animaWorkflow.defaultParams.negativePrompt).toBe(
      'worst quality, low quality, artist name, blurry, jpeg artifacts, chromatic aberration',
    )
  })

  it('applies positive/negative prompt, resolution and seed', () => {
    const wf = animaWorkflow.buildPrompt({ ...base, negativePrompt: 'blurry' })
    expect(wf['60:11'].inputs.text).toBe('a cat')
    expect(wf['60:12'].inputs.text).toBe('blurry')
    expect(wf['60:28'].inputs.width).toBe('832')
    expect(wf['60:19'].inputs.seed).toBe('42')
  })

  it('adds detailer nodes and repoints SaveImage when detailer is on', () => {
    const wf = animaWorkflow.buildPrompt({ ...base, detailer: true })
    expect(wf['det:face'].class_type).toBe('FaceDetailer')
    expect(wf['46'].inputs.images).toEqual(['det:face', 0])
  })

  it('omits detailer nodes when detailer is false', () => {
    const wf = animaWorkflow.buildPrompt(base) // base has detailer: false
    expect(wf['det:face']).toBeUndefined()
    expect(wf['det:provider']).toBeUndefined()
  })

  it('detailer composes after the hires-fix (wraps its decoded output)', () => {
    const wf = animaWorkflow.buildPrompt({ ...base, upscale: true, detailer: true })
    expect(wf['det:face'].inputs.image).toEqual(['hires:decode', 0])
    expect(wf['46'].inputs.images).toEqual(['det:face', 0])
  })

  it('detailer without upscale wraps the raw VAE-decoded image', () => {
    const wf = animaWorkflow.buildPrompt({ ...base, upscale: false, detailer: true })
    expect(wf['det:face'].inputs.image).toEqual(['60:8', 0])
    expect(wf['46'].inputs.images).toEqual(['det:face', 0])
  })

  it('swaps the base UNET for an Aria model and applies a manual LoRA independently', () => {
    expect(animaWorkflow.buildPrompt(base)['60:44'].inputs.unet_name).toBe('anima-aesthetic-v1.1.safetensors')
    // Aria swaps the UNET (60:44), not the LoRA node (60:61).
    const aria = animaWorkflow.buildPrompt({ ...base, ariaModel: 'aria_anima_01.safetensors' })
    expect(aria['60:44'].inputs.unet_name).toBe('aria_anima_01.safetensors')
    // A manual LoRA drives the LoRA node regardless of the Aria selection.
    const both = animaWorkflow.buildPrompt({ ...base, ariaModel: 'aria_anima_01.safetensors', lora1: 'extra.safetensors', lora1Strength: 0.7 })
    expect(both['60:44'].inputs.unet_name).toBe('aria_anima_01.safetensors')
    expect(both['60:61'].inputs.lora_name).toBe('extra.safetensors')
    expect(both['60:61'].inputs.strength_model).toBe('0.7')
    // The KSampler reads the model through the LoRA node when one is applied.
    expect(both['60:19'].inputs.model).toEqual(['60:61', 0])
  })

  it('bypasses the LoRA node entirely when no manual LoRA is selected', () => {
    // LoraLoaderModelOnly has no "None" sentinel and its JSON default points at a
    // LoRA that may not be installed, so an empty slot must drop the node (not
    // ship the stale default and fail ComfyUI validation). The model then flows
    // straight from the UNETLoader (60:44) into every downstream pass.
    const wf = animaWorkflow.buildPrompt(base)
    expect(wf['60:61']).toBeUndefined()
    expect(wf['60:19'].inputs.model).toEqual(['60:44', 0])
    // The hires-fix pass also sources the model from the UNETLoader.
    expect(wf['hires:sample'].inputs.model).toEqual(['60:44', 0])
  })
})

describe('animaTurboWorkflow', () => {
  it('loads the distilled checkpoint at its own CFG-1 / low-step budget', () => {
    const wf = animaTurboWorkflow.buildPrompt(base)
    expect(wf['60:44'].inputs.unet_name).toBe('anima-turbo-v1.0.safetensors')
    expect(wf['60:19'].inputs.steps).toBe(10)
    expect(wf['60:19'].inputs.cfg).toBe(1)
    // euler, not the Aesthetic family's er_sde: an SDE sampler re-injects noise
    // every step, which fights the distillation at 10 steps.
    expect(wf['60:19'].inputs.sampler_name).toBe('euler')
  })

  it('carries CFG 1 into the hires-fix and detailer passes', () => {
    // A Turbo model sampled at the Aesthetic family's CFG 4 burns the image, so
    // every pass that re-samples must inherit the variant's cfg, not the template's.
    const wf = animaTurboWorkflow.buildPrompt({ ...base, upscale: true, detailer: true })
    expect(wf['hires:sample'].inputs.cfg).toBe(1)
    expect(wf['hires:sample'].inputs.sampler_name).toBe('euler')
    expect(wf['det:face'].inputs.cfg).toBe(1)
    expect(wf['det:face'].inputs.sampler_name).toBe('euler')
  })

  it('hides the negative prompt (CFG 1 skips the uncond pass entirely)', () => {
    expect(animaTurboWorkflow.supportsNegativePrompt).toBe(false)
    expect(animaTurboWorkflow.defaultParams.negativePrompt).toBe('')
  })

  it('leaves the Aesthetic family on its own settings', () => {
    const wf = animaWorkflow.buildPrompt(base)
    expect(wf['60:44'].inputs.unet_name).toBe('anima-aesthetic-v1.1.safetensors')
    expect(wf['60:19'].inputs.steps).toBe(30)
    expect(wf['60:19'].inputs.cfg).toBe(4)
    expect(wf['60:19'].inputs.sampler_name).toBe('er_sde')
  })
})
