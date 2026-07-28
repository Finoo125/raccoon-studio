import { describe, it, expect } from 'vitest'
import { krea2TurboWorkflow, krea2RawWorkflow } from './krea2'
import type { GenerationParams } from '@/types/workflow'

const base: GenerationParams = {
  prompt: 'a cat',
  width: 832,
  height: 1216,
  seed: 42,
  upscale: false,
  detailer: false,
}

describe('krea2 variants', () => {
  it('turbo loads the distilled checkpoint and samples at 8 steps / cfg 1', () => {
    const wf = krea2TurboWorkflow.buildPrompt(base)
    expect(wf['k:unet'].inputs.unet_name).toBe('krea2_turbo_fp8_scaled.safetensors')
    expect(wf['k:sampler'].inputs.steps).toBe(8)
    expect(wf['k:sampler'].inputs.cfg).toBe(1)
    expect(wf['k:sampler'].inputs.sampler_name).toBe('er_sde')
    expect(wf['k:sampler'].inputs.scheduler).toBe('simple')
  })

  it('raw loads the base checkpoint and samples at 52 steps / cfg 4', () => {
    const wf = krea2RawWorkflow.buildPrompt(base)
    expect(wf['k:unet'].inputs.unet_name).toBe('krea2_raw_fp8_scaled.safetensors')
    expect(wf['k:sampler'].inputs.steps).toBe(52)
    expect(wf['k:sampler'].inputs.cfg).toBe(4)
  })

  it('shares one text encoder and VAE, and never adds a shift node', () => {
    const wf = krea2TurboWorkflow.buildPrompt(base)
    expect(wf['k:clip'].inputs.clip_name).toBe('qwen3vl_4b_fp8_scaled.safetensors')
    expect(wf['k:clip'].inputs.type).toBe('krea2')
    expect(wf['k:vae'].inputs.vae_name).toBe('qwen_image_vae.safetensors')
    // Krea2's shift (1.15) lives in ComfyUI's own model config; a ModelSampling
    // node here would double-apply it.
    expect(Object.values(wf).some((n) => n.class_type.startsWith('ModelSampling'))).toBe(false)
  })

  it('zeroes the negative conditioning on turbo (cfg 1 runs no uncond pass)', () => {
    const wf = krea2TurboWorkflow.buildPrompt({ ...base, negativePrompt: 'blurry' })
    expect(wf['k:neg'].class_type).toBe('ConditioningZeroOut')
    expect(krea2TurboWorkflow.supportsNegativePrompt).toBe(false)
  })

  it('encodes a real negative prompt on raw (cfg 4 runs an uncond pass)', () => {
    const wf = krea2RawWorkflow.buildPrompt({ ...base, negativePrompt: 'blurry' })
    expect(wf['k:neg'].class_type).toBe('CLIPTextEncode')
    expect(wf['k:neg'].inputs.text).toBe('blurry')
    expect(wf['k:neg'].inputs.clip).toEqual(['k:loras', 1])
    expect(krea2RawWorkflow.supportsNegativePrompt).toBe(true)
  })

  it('encodes an empty negative on raw when the user left it blank', () => {
    expect(krea2RawWorkflow.buildPrompt(base)['k:neg'].inputs.text).toBe('')
  })
})

describe('krea2 prompt handling', () => {
  it('applies prompt, resolution and seed', () => {
    const wf = krea2TurboWorkflow.buildPrompt(base)
    expect(wf['k:pos'].inputs.text).toBe('a cat')
    expect(wf['k:latent'].inputs.width).toBe(832)
    expect(wf['k:latent'].inputs.height).toBe(1216)
    expect(wf['k:sampler'].inputs.seed).toBe(42)
  })

  it('resolves a negative seed to a random one', () => {
    expect(krea2TurboWorkflow.buildPrompt({ ...base, seed: -1 })['k:sampler'].inputs.seed)
      .toBeGreaterThanOrEqual(0)
  })

  it('drops the enhancer node entirely when the toggle is off', () => {
    // Deleting the node rather than flipping a baked PrimitiveBoolean also
    // sidesteps ComfyUI's bool("false") === True coercion trap.
    const wf = krea2TurboWorkflow.buildPrompt(base)
    expect(wf['k:enhance']).toBeUndefined()
    expect(wf['k:pos'].inputs.text).toBe('a cat')
  })

  it('routes the prompt through TextGenerate when the enhancer is on', () => {
    const wf = krea2TurboWorkflow.buildPrompt({ ...base, promptEnhancer: true })
    expect(wf['k:enhance'].class_type).toBe('TextGenerate')
    expect(wf['k:pos'].inputs.text).toEqual(['k:enhance', 0])
    expect(wf['k:enhance'].inputs.prompt).toContain('a cat')
    expect(wf['k:enhance'].inputs.clip).toEqual(['k:clip', 0])
    // DynamicCombo stays in its flattened API-format shape.
    expect(wf['k:enhance'].inputs['sampling_mode']).toBe('on')
    expect(wf['k:enhance'].inputs['sampling_mode.temperature']).toBe(0.7)
  })

  it('does not moralise at the user in the enhancer system prompt', () => {
    // The stock system prompt tells the LLM to "assume clothing covers genitals
    // and intimate anatomy", which silently rewrites the user's own prompt
    // against them — exactly what the refusal-reduction LoRA is here to stop.
    const system = krea2TurboWorkflow.buildPrompt({ ...base, promptEnhancer: true })['k:enhance']
      .inputs.prompt as string
    expect(system).not.toMatch(/intimate anatomy/i)
    // The rules that make the enhancer useful are kept.
    expect(system).toMatch(/Faithfulness First/)
    expect(system).toMatch(/Preserve User Medium/)
  })

  it('wires the parallel batch into the latent, capped at 4', () => {
    expect(krea2TurboWorkflow.buildPrompt(base)['k:latent'].inputs.batch_size).toBe(1)
    expect(krea2TurboWorkflow.buildPrompt({ ...base, batchSize: 3 })['k:latent'].inputs.batch_size).toBe(3)
    expect(krea2TurboWorkflow.buildPrompt({ ...base, batchSize: 8 })['k:latent'].inputs.batch_size).toBe(4)
  })

  it('defaults the prompt enhancer to off so a written prompt is used verbatim', () => {
    expect(krea2TurboWorkflow.defaultParams.promptEnhancer).toBe(false)
    expect(krea2RawWorkflow.defaultParams.promptEnhancer).toBe(false)
  })

  it('does not leak state between builds', () => {
    krea2TurboWorkflow.buildPrompt({ ...base, promptEnhancer: true })
    expect(krea2TurboWorkflow.buildPrompt(base)['k:enhance']).toBeUndefined()
  })
})

describe('krea2 registration', () => {
  it('declares the krea2 LoRA family on both variants', () => {
    expect(krea2TurboWorkflow.loraFamily).toBe('krea2')
    expect(krea2RawWorkflow.loraFamily).toBe('krea2')
  })

  it('swaps the base UNET for a chosen Aria model rather than a LoRA slot', () => {
    const wf = krea2TurboWorkflow.buildPrompt({ ...base, ariaModel: 'aria_krea.safetensors' })
    expect(wf['k:unet'].inputs.unet_name).toBe('aria_krea.safetensors')
    expect(krea2TurboWorkflow.ariaModelKind).toBe('unet')
  })

  it('has no ControlNet or IP-Adapter support (no published Krea2 model)', () => {
    expect(krea2TurboWorkflow.supportsControlNet).toBe(false)
    expect(krea2TurboWorkflow.supportsIpAdapter).toBe(false)
  })
})

describe('krea2 user LoRA stack', () => {
  it('defaults every rgthree slot to the "None" sentinel', () => {
    const wf = krea2TurboWorkflow.buildPrompt(base)
    expect(wf['k:loras'].inputs.lora_01).toBe('None')
    expect(wf['k:loras'].inputs.lora_04).toBe('None')
  })

  it('writes selected LoRAs into the stack slots', () => {
    const wf = krea2TurboWorkflow.buildPrompt({
      ...base,
      loras: [{ name: 'a.safetensors', strength: 0.8 }, { name: 'b.safetensors', strength: 0.6 }],
    })
    expect(wf['k:loras'].inputs.lora_01).toBe('a.safetensors')
    expect(wf['k:loras'].inputs.strength_01).toBe(0.8)
    expect(wf['k:loras'].inputs.lora_02).toBe('b.safetensors')
    expect(wf['k:loras'].inputs.strength_02).toBe(0.6)
  })

  it('compacts gaps so an empty middle row leaves no gap in the stack', () => {
    const wf = krea2TurboWorkflow.buildPrompt({
      ...base,
      loras: [{ name: '', strength: 1 }, { name: 'b.safetensors', strength: 0.6 }],
    })
    expect(wf['k:loras'].inputs.lora_01).toBe('b.safetensors')
    expect(wf['k:loras'].inputs.lora_02).toBe('None')
  })

  it('chains a fifth LoRA upstream — the rgthree stack stops at four', () => {
    const wf = krea2TurboWorkflow.buildPrompt({
      ...base,
      loras: [1, 2, 3, 4, 5].map((n) => ({ name: `l${n}.safetensors`, strength: 0.5 })),
    })
    expect(wf['k:loras'].inputs.lora_04).toBe('l4.safetensors')
    expect(wf['lora:x:0'].class_type).toBe('LoraLoader')
    expect(wf['lora:x:0'].inputs.lora_name).toBe('l5.safetensors')
    expect(wf['k:loras'].inputs.model).toEqual(['lora:x:0', 0])
    expect(wf['k:loras'].inputs.clip).toEqual(['lora:x:0', 1])
  })
})

describe('krea2 built-in LoRAs', () => {
  const withBoth: GenerationParams = {
    ...base,
    krea2RefusalLora: 'Krea2_TextFusion_Refusal_Reduction.safetensors',
    krea2ProjectorLora: 'krea2_projector_scale.safetensors',
    krea2ProjectorStrength: 0.05,
  }

  it('applies the refusal LoRA model-only at a fixed strength of 1', () => {
    const wf = krea2TurboWorkflow.buildPrompt(withBoth)
    // Model-only: neither built-in carries text-encoder tensors, so patching
    // CLIP would be wrong.
    expect(wf['krea2:builtin:0'].class_type).toBe('LoraLoaderModelOnly')
    expect(wf['krea2:builtin:0'].inputs.lora_name).toBe('Krea2_TextFusion_Refusal_Reduction.safetensors')
    expect(wf['krea2:builtin:0'].inputs.strength_model).toBe(1)
    expect(wf['krea2:builtin:0'].inputs.model).toEqual(['k:unet', 0])
  })

  it('applies the projector LoRA at the slider strength', () => {
    const wf = krea2TurboWorkflow.buildPrompt(withBoth)
    expect(wf['krea2:builtin:1'].class_type).toBe('LoraLoaderModelOnly')
    expect(wf['krea2:builtin:1'].inputs.lora_name).toBe('krea2_projector_scale.safetensors')
    expect(wf['krea2:builtin:1'].inputs.strength_model).toBe(0.05)
    // Chained, so the second reads the first…
    expect(wf['krea2:builtin:1'].inputs.model).toEqual(['krea2:builtin:0', 0])
    // …and the user stack reads the tail of the built-in chain.
    expect(wf['k:loras'].inputs.model).toEqual(['krea2:builtin:1', 0])
  })

  it('honours a custom projector strength', () => {
    const wf = krea2TurboWorkflow.buildPrompt({ ...withBoth, krea2ProjectorStrength: 0.2 })
    expect(wf['krea2:builtin:1'].inputs.strength_model).toBe(0.2)
  })

  it('leaves the projector off when no strength was passed', () => {
    // Default is 0 — the knob is opt-in, so an unset slider must not silently
    // patch the model.
    const wf = krea2TurboWorkflow.buildPrompt({ ...withBoth, krea2ProjectorStrength: undefined })
    expect(wf['krea2:builtin:1']).toBeUndefined()
  })

  it('omits the projector at strength 0, keeping the refusal LoRA', () => {
    const wf = krea2TurboWorkflow.buildPrompt({ ...withBoth, krea2ProjectorStrength: 0 })
    expect(wf['krea2:builtin:0'].inputs.lora_name).toBe('Krea2_TextFusion_Refusal_Reduction.safetensors')
    expect(wf['krea2:builtin:1']).toBeUndefined()
    expect(wf['k:loras'].inputs.model).toEqual(['krea2:builtin:0', 0])
  })

  it('emits nothing when neither built-in is installed', () => {
    // The form only passes a filename it saw in ComfyUI's own list, so absent
    // means "not downloaded" — the graph must degrade rather than fail
    // validation with value_not_in_list.
    const wf = krea2TurboWorkflow.buildPrompt(base)
    expect(wf['krea2:builtin:0']).toBeUndefined()
    expect(wf['k:loras'].inputs.model).toEqual(['k:unet', 0])
  })

  it('applies the projector alone when only it is installed', () => {
    const wf = krea2TurboWorkflow.buildPrompt({
      ...base,
      krea2ProjectorLora: 'krea2_projector_scale.safetensors',
      krea2ProjectorStrength: 0.05,
    })
    expect(wf['krea2:builtin:0'].inputs.lora_name).toBe('krea2_projector_scale.safetensors')
    expect(wf['krea2:builtin:1']).toBeUndefined()
  })

  it('composes built-ins with an overflowing user stack', () => {
    const wf = krea2TurboWorkflow.buildPrompt({
      ...withBoth,
      loras: [1, 2, 3, 4, 5].map((n) => ({ name: `l${n}.safetensors`, strength: 0.5 })),
    })
    // built-in chain → user overflow chain → rgthree stack
    expect(wf['lora:x:0'].inputs.model).toEqual(['krea2:builtin:1', 0])
    expect(wf['k:loras'].inputs.model).toEqual(['lora:x:0', 0])
  })

  it('applies the built-ins on RAW too', () => {
    const wf = krea2RawWorkflow.buildPrompt(withBoth)
    expect(wf['krea2:builtin:0'].inputs.lora_name).toBe('Krea2_TextFusion_Refusal_Reduction.safetensors')
  })
})

describe('krea2 post-processing', () => {
  const post: GenerationParams = { ...base, upscale: undefined, detailer: undefined }

  it('runs a latent hires-fix by default at the variant step count', () => {
    const wf = krea2TurboWorkflow.buildPrompt({ ...post, detailer: false })
    expect(wf['hires:upscale_model'].inputs.model_name).toBe('4x-UltraSharp.pth')
    expect(wf['hires:scale'].inputs.scale_by).toBeCloseTo(0.375)
    expect(wf['hires:sample'].inputs.denoise).toBe(0.2)
    expect(wf['hires:sample'].inputs.steps).toBe(8)
    expect(wf['hires:sample'].inputs.cfg).toBe(1)
    expect(wf['hires:sample'].inputs.seed).toBe(42)
  })

  it('reuses RAW native sampling in the hires pass — KSampler truncates by denoise', () => {
    // 52 steps at denoise 0.2 is ~10 real steps, so there is no separate hires
    // step budget to tune.
    const wf = krea2RawWorkflow.buildPrompt({ ...post, detailer: false })
    expect(wf['hires:sample'].inputs.steps).toBe(52)
    expect(wf['hires:sample'].inputs.cfg).toBe(4)
  })

  it('drops the hires-fix and grains the decode when upscale is off', () => {
    const wf = krea2TurboWorkflow.buildPrompt(base)
    expect(wf['hires:upscale']).toBeUndefined()
    expect(wf['grain:film'].inputs.image).toEqual(['k:decode', 0])
    expect(wf['k:save'].inputs.images).toEqual(['grain:film', 0])
  })

  it('adds the detailer and composes it after the hires-fix', () => {
    const wf = krea2TurboWorkflow.buildPrompt({ ...post, detailer: true })
    expect(wf['det:face'].class_type).toBe('FaceDetailer')
    expect(wf['det:face'].inputs.image).toEqual(['hires:decode', 0])
    expect(wf['grain:film'].inputs.image).toEqual(['det:face', 0])
  })

  it('omits the detailer when it is off', () => {
    expect(krea2TurboWorkflow.buildPrompt(base)['det:face']).toBeUndefined()
  })

  it('runs the face swap last so the diffusion passes cannot erode it', () => {
    const wf = krea2TurboWorkflow.buildPrompt({
      ...post, detailer: false, faceSwap: true, inputImage: 'face.png',
    })
    expect(wf['hires:upscale'].inputs.image).toEqual(['k:decode', 0])
    expect(wf['swap:source'].inputs.image).toBe('face.png')
    expect(wf['swap:reactor'].inputs.input_image).toEqual(['hires:decode', 0])
    expect(wf['grain:film'].inputs.image).toEqual(['swap:rgb', 0])
    expect(wf['k:save'].inputs.images).toEqual(['grain:film', 0])
  })

  it('strips the swap nodes when toggled on with no source', () => {
    expect(krea2TurboWorkflow.buildPrompt({ ...base, faceSwap: true })['swap:reactor']).toBeUndefined()
  })

  it('always adds a subtle film grain as the final node', () => {
    const wf = krea2TurboWorkflow.buildPrompt(base)
    expect(wf['grain:film'].class_type).toBe('Film Grain')
    expect(wf['grain:film'].inputs.intensity).toBe(0.04)
  })

  it('rewires the sampler latent from an encoded base image in img2img', () => {
    const wf = krea2TurboWorkflow.buildPrompt({
      ...base, baseImage: 'src.png', editMode: 'img2img', denoise: 0.65,
    })
    expect(wf['i2i:load'].inputs.image).toBe('src.png')
    expect(wf['k:sampler'].inputs.latent_image).not.toEqual(['k:latent', 0])
    expect(wf['k:sampler'].inputs.denoise).toBe(0.65)
    expect(krea2TurboWorkflow.supportsImg2Img).toBe(true)
  })
})
