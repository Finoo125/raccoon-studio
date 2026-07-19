import { describe, it, expect } from 'vitest'
import { sdxlWorkflow, ponyWorkflow, illustriousWorkflow } from './sdxl'
import type { GenerationParams } from '@/types/workflow'

const base: GenerationParams = { prompt: 'a fox', width: 832, height: 1216, seed: 42, detailer: false }

describe('sdxlWorkflow.buildPrompt', () => {
  it('loads the SDXL base checkpoint and applies prompt/resolution/seed', () => {
    const wf = sdxlWorkflow.buildPrompt(base)
    expect(wf['4'].inputs.ckpt_name).toBe('sd_xl_base_1.0.safetensors')
    expect(wf['6'].inputs.text).toBe('a fox')
    expect(wf['5'].inputs.width).toBe(832)
    expect(wf['5'].inputs.height).toBe(1216)
    expect(wf['3'].inputs.seed).toBe(42)
  })

  it('caps the latent batch at 4', () => {
    expect(sdxlWorkflow.buildPrompt(base)['5'].inputs.batch_size).toBe(1)
    expect(sdxlWorkflow.buildPrompt({ ...base, batchSize: 3 })['5'].inputs.batch_size).toBe(3)
    expect(sdxlWorkflow.buildPrompt({ ...base, batchSize: 9 })['5'].inputs.batch_size).toBe(4)
  })

  it('uses the default negative when none is supplied', () => {
    expect(sdxlWorkflow.buildPrompt(base)['7'].inputs.text).toBe('worst quality, low quality, jpeg artifacts')
    expect(sdxlWorkflow.buildPrompt({ ...base, negativePrompt: 'blurry' })['7'].inputs.text).toBe('blurry')
  })

  it('randomizes the seed when negative', () => {
    const seed = sdxlWorkflow.buildPrompt({ ...base, seed: -1 })['3'].inputs.seed
    expect(seed).toBeGreaterThanOrEqual(0)
  })

  it('replaces the base checkpoint with a chosen Aria checkpoint', () => {
    const wf = sdxlWorkflow.buildPrompt({ ...base, ariaModel: 'aria_realism_xl.safetensors' })
    expect(wf['4'].inputs.ckpt_name).toBe('aria_realism_xl.safetensors')
  })

  it('inserts muscgi LoRAs and re-points the model + clip consumers', () => {
    const wf = sdxlWorkflow.buildPrompt({ ...base, lora1: 'muscgi_x.safetensors', lora1Strength: 0.8 })
    // One LoraLoader inserted (node 100), chained from the checkpoint.
    expect(wf['100'].class_type).toBe('LoraLoader')
    expect(wf['100'].inputs.strength_clip).toBe(0.8)
    expect(wf['100'].inputs.lora_name).toBe('muscgi_x.safetensors')
    expect(wf['100'].inputs.strength_model).toBe(0.8)
    expect(wf['100'].inputs.model).toEqual(['4', 0])
    expect(wf['100'].inputs.clip).toEqual(['4', 1])
    // Consumers now read from the LoRA node.
    expect(wf['3'].inputs.model).toEqual(['100', 0])
    expect(wf['6'].inputs.clip).toEqual(['100', 1])
    expect(wf['7'].inputs.clip).toEqual(['100', 1])
  })

  it('chains two LoRAs in order', () => {
    const wf = sdxlWorkflow.buildPrompt({
      ...base, lora1: 'a.safetensors', lora2: 'b.safetensors',
    })
    expect(wf['100'].inputs.model).toEqual(['4', 0])
    expect(wf['101'].inputs.model).toEqual(['100', 0])
    expect(wf['3'].inputs.model).toEqual(['101', 0])
  })

  it('inserts no LoRA nodes when none are set', () => {
    const wf = sdxlWorkflow.buildPrompt(base)
    expect(wf['100']).toBeUndefined()
    expect(wf['3'].inputs.model).toEqual(['4', 0])
  })

  it('decodes through the checkpoint VAE by default (no sdxlVae)', () => {
    const wf = sdxlWorkflow.buildPrompt(base)
    expect(wf['vae:sdxl']).toBeUndefined()
    expect(wf['8'].inputs.vae).toEqual(['4', 2])
  })

  it('routes every VAE consumer through the dedicated VAE when sdxlVae is set', () => {
    // Fixes washed-out colors (e.g. Illustrious): a VAELoader replaces the
    // checkpoint VAE for decode + hires-fix. Gated by the form on availability.
    const wf = illustriousWorkflow.buildPrompt({ ...base, sdxlVae: 'sdxl_vae.safetensors', detailer: false })
    expect(wf['vae:sdxl'].inputs.vae_name).toBe('sdxl_vae.safetensors')
    expect(wf['8'].inputs.vae).toEqual(['vae:sdxl', 0])
    expect(wf['hires:sample']).toBeDefined()
    expect(wf['hires:encode'].inputs.vae).toEqual(['vae:sdxl', 0])
    expect(wf['hires:decode'].inputs.vae).toEqual(['vae:sdxl', 0])
  })
})

describe('sdxlWorkflow hires-fix', () => {
  it('runs a latent hires-fix by default (4x-UltraSharp, net 1.5×, denoise 0.2, 12 steps)', () => {
    const wf = sdxlWorkflow.buildPrompt(base)
    expect(wf['hires:upscale_model'].inputs.model_name).toBe('4x-UltraSharp.pth')
    expect(wf['hires:upscale'].inputs.image).toEqual(['8', 0])
    expect(wf['hires:scale'].inputs.scale_by).toBeCloseTo(0.375)
    expect(wf['hires:sample'].inputs.denoise).toBe(0.2)
    expect(wf['hires:sample'].inputs.steps).toBe(12)
    expect(wf['hires:sample'].inputs.seed).toBe(42)
    // Grain (photoreal base) is the final node, wrapping the hires-fix output.
    expect(wf['9'].inputs.images).toEqual(['grain:film', 0])
    expect(wf['grain:film'].inputs.image).toEqual(['hires:decode', 0])
  })

  it('removes the legacy ESRGAN upscale nodes', () => {
    const wf = sdxlWorkflow.buildPrompt(base)
    expect(wf['10']).toBeUndefined()
    expect(wf['11']).toBeUndefined()
    expect(wf['12']).toBeUndefined()
  })

  it('resamples with the LoRA-chain tail as its model', () => {
    const wf = sdxlWorkflow.buildPrompt({ ...base, lora1: 'a.safetensors' })
    expect(wf['hires:sample'].inputs.model).toEqual(['100', 0])
  })

  it('drops the hires-fix and saves the decoded image when upscale is off', () => {
    const wf = sdxlWorkflow.buildPrompt({ ...base, upscale: false })
    expect(wf['hires:upscale']).toBeUndefined()
    expect(wf['hires:sample']).toBeUndefined()
    // Grain still runs last, wrapping the decoded image.
    expect(wf['9'].inputs.images).toEqual(['grain:film', 0])
    expect(wf['grain:film'].inputs.image).toEqual(['8', 0])
  })
})

describe('sdxl clip skip', () => {
  it('SDXL base does not set a clip-skip layer', () => {
    const wf = sdxlWorkflow.buildPrompt(base)
    expect(wf['clip:skip']).toBeUndefined()
    expect(wf['6'].inputs.clip).toEqual(['4', 1])
  })

  it('pony inserts CLIPSetLastLayer -2 and repoints both encoders', () => {
    const wf = ponyWorkflow.buildPrompt(base)
    expect(wf['clip:skip'].class_type).toBe('CLIPSetLastLayer')
    expect(wf['clip:skip'].inputs.stop_at_clip_layer).toBe(-2)
    expect(wf['clip:skip'].inputs.clip).toEqual(['4', 1])
    expect(wf['6'].inputs.clip).toEqual(['clip:skip', 0])
    expect(wf['7'].inputs.clip).toEqual(['clip:skip', 0])
  })

  it('illustrious clip-skip reads the LoRA-chain clip tail', () => {
    const wf = illustriousWorkflow.buildPrompt({ ...base, lora1: 'a.safetensors' })
    expect(wf['clip:skip'].inputs.clip).toEqual(['100', 1])
    expect(wf['6'].inputs.clip).toEqual(['clip:skip', 0])
  })

  it('pony detailer uses the clip-skip output as its clip ref', () => {
    const wf = ponyWorkflow.buildPrompt({ ...base, detailer: true })
    expect(wf['det:face'].inputs.clip).toEqual(['clip:skip', 0])
  })
})

describe('sdxlWorkflow detailer', () => {
  it('adds detailer nodes and repoints SaveImage when detailer is on', () => {
    const wf = sdxlWorkflow.buildPrompt({ ...base, detailer: true })
    expect(wf['det:face'].class_type).toBe('FaceDetailer')
    // Grain wraps the detailer output as the final save source.
    expect(wf['grain:film'].inputs.image).toEqual(['det:face', 0])
    expect(wf['9'].inputs.images).toEqual(['grain:film', 0])
  })

  it('omits detailer nodes when detailer is false', () => {
    const wf = sdxlWorkflow.buildPrompt(base) // base has detailer: false
    expect(wf['det:face']).toBeUndefined()
  })

  it('detailer composes after the hires-fix (wraps its decoded output)', () => {
    const wf = sdxlWorkflow.buildPrompt({ ...base, upscale: true, detailer: true })
    expect(wf['det:face'].inputs.image).toEqual(['hires:decode', 0])
    expect(wf['9'].inputs.images).toEqual(['grain:film', 0])
  })

  it('detailer without upscale wraps the raw VAE-decoded image', () => {
    const wf = sdxlWorkflow.buildPrompt({ ...base, upscale: false, detailer: true })
    expect(wf['det:face'].inputs.image).toEqual(['8', 0])
    expect(wf['9'].inputs.images).toEqual(['grain:film', 0])
  })

  it('detailer with LoRA uses the LoRA-chain tail as model/clip refs', () => {
    const wf = sdxlWorkflow.buildPrompt({ ...base, lora1: 'a.safetensors', detailer: true })
    expect(wf['det:face'].inputs.model).toEqual(['100', 0])
    expect(wf['det:face'].inputs.clip).toEqual(['100', 1])
  })
})

describe('pony + illustrious families', () => {
  it('pony pins its checkpoint, model-card steps 28/cfg 5 + Euler a, no hidden prefix', () => {
    const wf = ponyWorkflow.buildPrompt(base)
    expect(wf['4'].inputs.ckpt_name).toBe('ponyDiffusionV6XL_v6StartWithThisOne.safetensors')
    // Quality tags now live in the visible default prompt, not a hidden prefix.
    expect(wf['6'].inputs.text).toBe('a fox')
    expect(wf['3'].inputs.steps).toBe(28)
    expect(wf['3'].inputs.cfg).toBe(5)
    expect(wf['3'].inputs.sampler_name).toBe('euler_ancestral')
    expect(wf['3'].inputs.scheduler).toBe('normal')
  })

  it('illustrious pins its checkpoint, recommended steps 28/cfg 5 + Euler a, no hidden prefix', () => {
    const wf = illustriousWorkflow.buildPrompt(base)
    expect(wf['4'].inputs.ckpt_name).toBe('Illustrious-XL-v0.1.safetensors')
    expect(wf['6'].inputs.text).toBe('a fox')
    expect(wf['3'].inputs.steps).toBe(28)
    expect(wf['3'].inputs.cfg).toBe(5)
    expect(wf['3'].inputs.sampler_name).toBe('euler_ancestral')
    expect(wf['3'].inputs.scheduler).toBe('normal')
  })

  it('pony + illustrious hires-fix matches the metadata resample (denoise 0.35, hires CFG 5) on the anime AnimeSharp upscaler', () => {
    for (const w of [ponyWorkflow, illustriousWorkflow]) {
      const wf = w.buildPrompt(base)
      expect(wf['hires:upscale_model'].inputs.model_name).toBe('4x-AnimeSharp.pth')
      expect(wf['hires:sample'].inputs.denoise).toBe(0.35)
      expect(wf['hires:sample'].inputs.cfg).toBe(5)
      expect(wf['hires:scale'].inputs.scale_by).toBeCloseTo(0.375)
    }
  })

  it('SDXL base uses DPM++ 2M SDE + Karras', () => {
    const wf = sdxlWorkflow.buildPrompt(base)
    expect(wf['3'].inputs.sampler_name).toBe('dpmpp_2m_sde')
    expect(wf['3'].inputs.scheduler).toBe('karras')
  })

  it('seeds per-model quality-tag defaults: Pony score ladder vs clean booru tags', () => {
    // Pony relies on its score_* ladder.
    expect(ponyWorkflow.defaultParams.prompt).toBe('score_9, score_8_up, score_7_up, score_6_up, ')
    expect(ponyWorkflow.defaultParams.negativePrompt).toContain('score_4, score_3, score_2, score_1')
    // Illustrious uses clean Danbooru quality tags with no score_* vocabulary.
    expect(illustriousWorkflow.defaultParams.prompt).toBe('masterpiece, best quality, amazing quality, ')
    expect(illustriousWorkflow.defaultParams.prompt).not.toContain('score_')
    expect(illustriousWorkflow.defaultParams.negativePrompt).not.toContain('score_')
    // SDXL base starts from a blank positive prompt (no anime quality tags).
    expect(sdxlWorkflow.defaultParams.prompt).toBeUndefined()
    expect(sdxlWorkflow.defaultParams.negativePrompt).toBe('worst quality, low quality, jpeg artifacts')
  })

  it('adds film grain to the photoreal SDXL base but not the anime families', () => {
    expect(sdxlWorkflow.buildPrompt(base)['grain:film'].class_type).toBe('Film Grain')
    expect(ponyWorkflow.buildPrompt(base)['grain:film']).toBeUndefined()
    expect(illustriousWorkflow.buildPrompt(base)['grain:film']).toBeUndefined()
  })

  it('all three declare ariaModelKind checkpoint, upscale and detailer', () => {
    for (const w of [sdxlWorkflow, ponyWorkflow, illustriousWorkflow]) {
      expect(w.ariaModelKind).toBe('checkpoint')
      expect(w.supportsUpscale).toBe(true)
      expect(w.supportsDetailer).toBe(true)
      expect(w.supportsLoRA).toBe(true)
    }
  })
})

describe('sdxlWorkflow face swap', () => {
  it('exposes face swap on the photoreal base but not the anime families', () => {
    expect(sdxlWorkflow.supportsInputImage).toBe(true)
    expect(ponyWorkflow.supportsInputImage).toBe(false)
    expect(illustriousWorkflow.supportsInputImage).toBe(false)
  })

  it('appends the ReActor swap chain from an uploaded photo, before film grain', () => {
    const wf = sdxlWorkflow.buildPrompt({ ...base, faceSwap: true, inputImage: 'face.png' })
    expect(wf['swap:source'].class_type).toBe('LoadImage')
    expect(wf['swap:source'].inputs.image).toBe('face.png')
    expect(wf['swap:reactor'].class_type).toBe('ReActorFaceSwap')
    // Grain runs last, wrapping the swapped output (swap:rgb), which itself
    // wraps the detailer/hires output.
    expect(wf['9'].inputs.images).toEqual(['grain:film', 0])
    expect(wf['grain:film'].inputs.image).toEqual(['swap:rgb', 0])
  })

  it('swaps from a saved face model when the source is a model', () => {
    const wf = sdxlWorkflow.buildPrompt({
      ...base, faceSwap: true, faceSwapSource: 'model', faceModel: 'alice.safetensors',
    })
    expect(wf['swap:source'].class_type).toBe('ReActorLoadFaceModel')
    expect(wf['swap:source'].inputs.face_model).toBe('alice.safetensors')
    expect(wf['swap:reactor'].inputs.face_model).toEqual(['swap:source', 0])
  })

  it('skips the swap when enabled but no source is provided', () => {
    const wf = sdxlWorkflow.buildPrompt({ ...base, faceSwap: true })
    expect(wf['swap:reactor']).toBeUndefined()
  })

  it('never swaps for the anime families even with a source set', () => {
    const wf = ponyWorkflow.buildPrompt({ ...base, faceSwap: true, inputImage: 'face.png' })
    expect(wf['swap:reactor']).toBeUndefined()
  })
})
