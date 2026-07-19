import { describe, it, expect } from 'vitest'
import { zImageTurboWorkflow } from './z-image-turbo'
import type { GenerationParams } from '@/types/workflow'

const base: GenerationParams = {
  prompt: 'a cat',
  width: 832,
  height: 1216,
  seed: 42,
  detailer: false,
}

describe('zImageTurboWorkflow.buildPrompt', () => {
  it('strips the face-swap nodes when face swap is off', () => {
    const wf = zImageTurboWorkflow.buildPrompt(base)
    expect(wf['swap:reactor']).toBeUndefined()
    expect(wf['swap:source']).toBeUndefined()
    expect(wf['swap:mask']).toBeUndefined()
    expect(wf['swap:color']).toBeUndefined()
    // Old baked-in nodes are gone from the JSON too.
    expect(wf['123']).toBeUndefined()
    expect(wf['124']).toBeUndefined()
    expect(wf['125']).toBeUndefined()
    expect(wf['hires:upscale'].inputs.image).toEqual(['57:8', 0])
  })

  it('defaults both LoRA slots to "None" — never the template\'s baked-in name', () => {
    // Regression: the template JSON shipped a hardcoded lora_02 ("ZIT_muscgi_1")
    // that leaked into every prompt with an empty slot 2, failing ComfyUI
    // validation. An unselected slot must resolve to the "None" sentinel.
    const wf = zImageTurboWorkflow.buildPrompt(base)
    expect(wf['57:62'].inputs.lora_01).toBe('None')
    expect(wf['57:62'].inputs.lora_02).toBe('None')
  })

  it('writes a selected LoRA into the corresponding stack slot', () => {
    const wf = zImageTurboWorkflow.buildPrompt({ ...base, lora1: 'a.safetensors', lora1Strength: 0.8, lora2: 'b.safetensors', lora2Strength: 0.6 })
    expect(wf['57:62'].inputs.lora_01).toBe('a.safetensors')
    expect(wf['57:62'].inputs.strength_01).toBe('0.8')
    expect(wf['57:62'].inputs.lora_02).toBe('b.safetensors')
    expect(wf['57:62'].inputs.strength_02).toBe('0.6')
  })

  it('runs a latent hires-fix by default (4x-UltraSharp, net 1.5×, denoise 0.2, turbo 8 steps)', () => {
    const wf = zImageTurboWorkflow.buildPrompt(base)
    expect(wf['hires:upscale_model'].inputs.model_name).toBe('4x-UltraSharp.pth')
    expect(wf['hires:scale'].inputs.scale_by).toBeCloseTo(0.375)
    expect(wf['hires:sample'].inputs.denoise).toBe(0.2)
    expect(wf['hires:sample'].inputs.steps).toBe(8)
    expect(wf['hires:sample'].inputs.seed).toBe(42)
    // Grain is the final node, wrapping the hires-fix output.
    expect(wf['9'].inputs.images).toEqual(['grain:film', 0])
    expect(wf['grain:film'].inputs.image).toEqual(['hires:decode', 0])
  })

  it('removes the legacy ESRGAN upscale nodes', () => {
    const wf = zImageTurboWorkflow.buildPrompt(base)
    expect(wf['120']).toBeUndefined()
    expect(wf['121']).toBeUndefined()
    expect(wf['122']).toBeUndefined()
  })

  it('drops the hires-fix and saves the decoded image when upscale is off', () => {
    const wf = zImageTurboWorkflow.buildPrompt({ ...base, upscale: false })
    expect(wf['hires:upscale']).toBeUndefined()
    expect(wf['hires:sample']).toBeUndefined()
    // Grain still runs last, wrapping the decoded image.
    expect(wf['9'].inputs.images).toEqual(['grain:film', 0])
    expect(wf['grain:film'].inputs.image).toEqual(['57:8', 0])
  })

  it('composes the swap after the decode when upscale and detailer are off', () => {
    const wf = zImageTurboWorkflow.buildPrompt({
      ...base, faceSwap: true, inputImage: 'face.png', upscale: false,
    })
    expect(wf['hires:upscale']).toBeUndefined()
    expect(wf['swap:reactor'].inputs.input_image).toEqual(['57:8', 0])
    // Swap output is flattened to RGB before grain (RGBA from a no-face mask
    // would otherwise crash the grain blend).
    expect(wf['swap:rgb'].inputs.image).toEqual(['swap:color', 0])
    expect(wf['grain:film'].inputs.image).toEqual(['swap:rgb', 0])
    expect(wf['9'].inputs.images).toEqual(['grain:film', 0])
  })

  it('runs the face swap last, after the hires-fix, then grains it', () => {
    const wf = zImageTurboWorkflow.buildPrompt({ ...base, faceSwap: true, inputImage: 'face.png' })
    // Hires-fix operates on the raw decode; the swap chain is layered on its output.
    expect(wf['hires:upscale'].inputs.image).toEqual(['57:8', 0])
    expect(wf['swap:source'].inputs.image).toBe('face.png')
    expect(wf['swap:reactor'].inputs.input_image).toEqual(['hires:decode', 0])
    expect(wf['swap:reactor'].inputs.source_image).toEqual(['swap:source', 0])
    expect(wf['swap:mask'].inputs.swapped_image).toEqual(['swap:reactor', 0])
    expect(wf['swap:color'].inputs.image_target).toEqual(['swap:mask', 0])
    // Face booster (GPEN @1024) drives the high-res restore before paste-back.
    expect(wf['swap:reactor'].inputs.face_boost).toEqual(['swap:boost', 0])
    expect(wf['swap:boost'].inputs.boost_model).toBe('GPEN-BFR-1024.onnx')
    // Grain is the final node over the color-matched swap.
    // Swap output is flattened to RGB before grain (RGBA from a no-face mask
    // would otherwise crash the grain blend).
    expect(wf['swap:rgb'].inputs.image).toEqual(['swap:color', 0])
    expect(wf['grain:film'].inputs.image).toEqual(['swap:rgb', 0])
    expect(wf['9'].inputs.images).toEqual(['grain:film', 0])
  })

  it('strips the face-swap nodes when toggled on but no source uploaded', () => {
    const wf = zImageTurboWorkflow.buildPrompt({ ...base, faceSwap: true })
    expect(wf['swap:reactor']).toBeUndefined()
    expect(wf['swap:source']).toBeUndefined()
    expect(wf['hires:upscale'].inputs.image).toEqual(['57:8', 0])
  })

  it('applies a chosen Aria model by swapping the base UNET, not a LoRA slot', () => {
    const none = zImageTurboWorkflow.buildPrompt(base)
    expect(none['57:28'].inputs.unet_name).toBe('z_image_turbo_bf16.safetensors')
    expect(none['57:62'].inputs.lora_03).toBe('None')
    const wf = zImageTurboWorkflow.buildPrompt({ ...base, ariaModel: 'aria_zit_01.safetensors' })
    expect(wf['57:28'].inputs.unet_name).toBe('aria_zit_01.safetensors')
    expect(wf['57:62'].inputs.lora_03).toBe('None')
  })

  it('wires the parallel batch into the latent, capped at 4', () => {
    expect(zImageTurboWorkflow.buildPrompt(base)['57:13'].inputs.batch_size).toBe(1)
    expect(zImageTurboWorkflow.buildPrompt({ ...base, batchSize: 3 })['57:13'].inputs.batch_size).toBe(3)
    expect(zImageTurboWorkflow.buildPrompt({ ...base, batchSize: 8 })['57:13'].inputs.batch_size).toBe(4)
  })

  it('applies prompt, resolution and seed', () => {
    const wf = zImageTurboWorkflow.buildPrompt(base)
    expect(wf['57:27'].inputs.text).toBe('a cat')
    expect(wf['57:13'].inputs.width).toBe('832')
    expect(wf['57:13'].inputs.height).toBe('1216')
    expect(wf['57:3'].inputs.seed).toBe('42')
  })

  it('adds detailer nodes and repoints SaveImage when detailer is on', () => {
    const wf = zImageTurboWorkflow.buildPrompt({ ...base, detailer: true })
    expect(wf['det:face'].class_type).toBe('FaceDetailer')
    // Grain wraps the detailer output as the final save source.
    expect(wf['grain:film'].inputs.image).toEqual(['det:face', 0])
    expect(wf['9'].inputs.images).toEqual(['grain:film', 0])
  })

  it('omits detailer nodes when detailer is false', () => {
    const wf = zImageTurboWorkflow.buildPrompt(base)
    expect(wf['det:face']).toBeUndefined()
  })

  it('detailer composes after the hires-fix', () => {
    const wf = zImageTurboWorkflow.buildPrompt({ ...base, upscale: true, detailer: true })
    expect(wf['det:face'].inputs.image).toEqual(['hires:decode', 0])
    expect(wf['9'].inputs.images).toEqual(['grain:film', 0])
  })

  it('face swap composes after the detailer (no upscale)', () => {
    const wf = zImageTurboWorkflow.buildPrompt({
      ...base, faceSwap: true, inputImage: 'face.png', upscale: false, detailer: true,
    })
    // Detailer runs on the decode; the swap composes over it; grain runs last.
    expect(wf['det:face'].inputs.image).toEqual(['57:8', 0])
    expect(wf['swap:reactor'].inputs.input_image).toEqual(['det:face', 0])
    // Swap output is flattened to RGB before grain (RGBA from a no-face mask
    // would otherwise crash the grain blend).
    expect(wf['swap:rgb'].inputs.image).toEqual(['swap:color', 0])
    expect(wf['grain:film'].inputs.image).toEqual(['swap:rgb', 0])
    expect(wf['9'].inputs.images).toEqual(['grain:film', 0])
  })

  it('defaults the swap model to inswapper and honors an explicit hyperswap choice', () => {
    const def = zImageTurboWorkflow.buildPrompt({ ...base, faceSwap: true, inputImage: 'face.png' })
    expect(def['swap:reactor'].inputs.swap_model).toBe('inswapper_128.onnx')
    expect(def['swap:boost'].class_type).toBe('ReActorFaceBoost')
    const hyper = zImageTurboWorkflow.buildPrompt({
      ...base, faceSwap: true, inputImage: 'face.png', faceSwapModel: 'hyperswap_1a_256.onnx',
    })
    expect(hyper['swap:reactor'].inputs.swap_model).toBe('hyperswap_1a_256.onnx')
    // Hyperswap runs without the booster.
    expect(hyper['swap:boost']).toBeUndefined()
  })

  it('always adds a subtle film-grain pass (photorealistic finish)', () => {
    const wf = zImageTurboWorkflow.buildPrompt(base)
    expect(wf['grain:film'].class_type).toBe('Film Grain')
    expect(wf['grain:film'].inputs.intensity).toBe(0.04)
    const swapped = zImageTurboWorkflow.buildPrompt({ ...base, faceSwap: true, inputImage: 'face.png' })
    expect(swapped['grain:film'].class_type).toBe('Film Grain')
  })
})
