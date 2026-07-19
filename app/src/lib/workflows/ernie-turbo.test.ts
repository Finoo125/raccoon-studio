import { describe, it, expect } from 'vitest'
import { ernieTurboWorkflow } from './ernie-turbo'
import type { GenerationParams } from '@/types/workflow'

const base: GenerationParams = {
  prompt: 'a cat',
  width: 832,
  height: 1216,
  seed: 42,
  detailer: false,
}

describe('ernieTurboWorkflow.buildPrompt', () => {
  it('runs a latent hires-fix by default (4x-UltraSharp, net 1.5×, denoise 0.2, turbo 8 steps)', () => {
    const wf = ernieTurboWorkflow.buildPrompt(base)
    expect(wf['hires:upscale_model'].inputs.model_name).toBe('4x-UltraSharp.pth')
    expect(wf['hires:scale'].inputs.scale_by).toBeCloseTo(0.375)
    expect(wf['hires:sample'].inputs.denoise).toBe(0.2)
    expect(wf['hires:sample'].inputs.steps).toBe(8)
    expect(wf['hires:sample'].inputs.seed).toBe(42)
    // Grain is the final node, wrapping the hires-fix output.
    expect(wf['73'].inputs.images).toEqual(['grain:film', 0])
    expect(wf['grain:film'].inputs.image).toEqual(['hires:decode', 0])
  })

  it('removes the legacy ESRGAN upscale nodes', () => {
    const wf = ernieTurboWorkflow.buildPrompt(base)
    expect(wf['117']).toBeUndefined()
    expect(wf['118']).toBeUndefined()
    expect(wf['119']).toBeUndefined()
  })

  it('strips the face-swap nodes when no source face is uploaded', () => {
    const wf = ernieTurboWorkflow.buildPrompt(base)
    expect(wf['swap:reactor']).toBeUndefined()
    expect(wf['swap:source']).toBeUndefined()
    expect(wf['swap:mask']).toBeUndefined()
    // Old baked-in nodes are gone from the JSON too.
    expect(wf['106']).toBeUndefined()
    expect(wf['111:107']).toBeUndefined()
    expect(wf['111:110']).toBeUndefined()
    // Hires-fix reads the VAE-decoded image directly.
    expect(wf['hires:upscale'].inputs.image).toEqual(['88:65', 0])
  })

  it('runs the face swap last, after the hires-fix, then grains it', () => {
    const wf = ernieTurboWorkflow.buildPrompt({ ...base, faceSwap: true, inputImage: 'face.png' })
    // Hires-fix now reads the raw decode (swap no longer runs before it).
    expect(wf['hires:upscale'].inputs.image).toEqual(['88:65', 0])
    expect(wf['swap:source'].inputs.image).toBe('face.png')
    expect(wf['swap:reactor'].inputs.input_image).toEqual(['hires:decode', 0])
    expect(wf['swap:reactor'].inputs.source_image).toEqual(['swap:source', 0])
    expect(wf['swap:reactor'].inputs.face_boost).toEqual(['swap:boost', 0])
    expect(wf['swap:reactor'].inputs.face_restore_model).toBe('GPEN-BFR-1024.onnx')
    expect(wf['swap:mask'].inputs.swapped_image).toEqual(['swap:reactor', 0])
    expect(wf['swap:color'].inputs.image_target).toEqual(['swap:mask', 0])
    // Swap output is flattened to RGB before grain (RGBA from a no-face mask
    // would otherwise crash the grain blend).
    expect(wf['swap:rgb'].inputs.image).toEqual(['swap:color', 0])
    expect(wf['grain:film'].inputs.image).toEqual(['swap:rgb', 0])
    expect(wf['73'].inputs.images).toEqual(['grain:film', 0])
  })

  it('drops the hires-fix and saves the source directly when upscale is off', () => {
    const wf = ernieTurboWorkflow.buildPrompt({ ...base, upscale: false })
    expect(wf['hires:upscale']).toBeUndefined()
    expect(wf['hires:sample']).toBeUndefined()
    // Grain still runs last, wrapping the decoded source.
    expect(wf['73'].inputs.images).toEqual(['grain:film', 0])
    expect(wf['grain:film'].inputs.image).toEqual(['88:65', 0])
  })

  it('composes the swap after the decode when upscale is off', () => {
    const wf = ernieTurboWorkflow.buildPrompt({
      ...base,
      faceSwap: true,
      inputImage: 'face.png',
      upscale: false,
    })
    expect(wf['swap:reactor'].inputs.input_image).toEqual(['88:65', 0])
    // Swap output is flattened to RGB before grain (RGBA from a no-face mask
    // would otherwise crash the grain blend).
    expect(wf['swap:rgb'].inputs.image).toEqual(['swap:color', 0])
    expect(wf['grain:film'].inputs.image).toEqual(['swap:rgb', 0])
    expect(wf['73'].inputs.images).toEqual(['grain:film', 0])
  })

  it('defaults the swap model to inswapper and honors an explicit hyperswap choice', () => {
    const def = ernieTurboWorkflow.buildPrompt({ ...base, faceSwap: true, inputImage: 'face.png' })
    expect(def['swap:reactor'].inputs.swap_model).toBe('inswapper_128.onnx')
    expect(def['swap:boost'].class_type).toBe('ReActorFaceBoost')
    const hyper = ernieTurboWorkflow.buildPrompt({
      ...base, faceSwap: true, inputImage: 'face.png', faceSwapModel: 'hyperswap_1a_256.onnx',
    })
    expect(hyper['swap:reactor'].inputs.swap_model).toBe('hyperswap_1a_256.onnx')
    // Hyperswap runs without the booster.
    expect(hyper['swap:boost']).toBeUndefined()
  })

  it('always adds a subtle film-grain pass (photorealistic finish)', () => {
    const wf = ernieTurboWorkflow.buildPrompt(base)
    expect(wf['grain:film'].class_type).toBe('Film Grain')
    expect(wf['grain:film'].inputs.intensity).toBe(0.04)
    const swapped = ernieTurboWorkflow.buildPrompt({ ...base, faceSwap: true, inputImage: 'face.png' })
    expect(swapped['grain:film'].class_type).toBe('Film Grain')
  })

  it('sets no LoRA by default so the standard workflow validates', () => {
    const wf = ernieTurboWorkflow.buildPrompt(base)
    expect(wf['88:104'].inputs.lora_01).toBe('None')
    expect(wf['88:104'].inputs.lora_02).toBe('None')
  })

  it('passes the prompt enhancer as a real boolean (bool("false") is True in ComfyUI)', () => {
    const off = ernieTurboWorkflow.buildPrompt(base)
    expect(off['88:96'].inputs.value).toBe(false)
    const on = ernieTurboWorkflow.buildPrompt({ ...base, promptEnhancer: true })
    expect(on['88:96'].inputs.value).toBe(true)
  })

  it('wires the parallel batch into the latent, capped at 4', () => {
    expect(ernieTurboWorkflow.buildPrompt(base)['88:71'].inputs.batch_size).toBe(1)
    expect(ernieTurboWorkflow.buildPrompt({ ...base, batchSize: 4 })['88:71'].inputs.batch_size).toBe(4)
    expect(ernieTurboWorkflow.buildPrompt({ ...base, batchSize: 8 })['88:71'].inputs.batch_size).toBe(4)
  })

  it('applies prompt, resolution and seed', () => {
    const wf = ernieTurboWorkflow.buildPrompt(base)
    expect(wf['88:94'].inputs.value).toBe('a cat')
    expect(wf['88:71'].inputs.width).toBe('832')
    expect(wf['88:70'].inputs.seed).toBe('42')
  })

  it('adds detailer nodes and repoints SaveImage when detailer is on', () => {
    const wf = ernieTurboWorkflow.buildPrompt({ ...base, detailer: true })
    expect(wf['det:face'].class_type).toBe('FaceDetailer')
    // Grain wraps the detailer output as the final save source.
    expect(wf['grain:film'].inputs.image).toEqual(['det:face', 0])
    expect(wf['73'].inputs.images).toEqual(['grain:film', 0])
  })

  it('omits detailer nodes when detailer is false', () => {
    const wf = ernieTurboWorkflow.buildPrompt(base)
    expect(wf['det:face']).toBeUndefined()
  })

  it('applies a chosen Aria model by swapping the base UNET', () => {
    expect(ernieTurboWorkflow.buildPrompt(base)['88:66'].inputs.unet_name).toBe('ernie-image-turbo.safetensors')
    const wf = ernieTurboWorkflow.buildPrompt({ ...base, ariaModel: 'Aria_ERNIE_v3.safetensors' })
    expect(wf['88:66'].inputs.unet_name).toBe('Aria_ERNIE_v3.safetensors')
    // The Aria model swaps the UNET, never a LoRA stack slot.
    expect(wf['88:104'].inputs.lora_03).toBe('None')
  })

  it('detailer composes after the hires-fix', () => {
    const wf = ernieTurboWorkflow.buildPrompt({ ...base, upscale: true, detailer: true })
    expect(wf['det:face'].inputs.image).toEqual(['hires:decode', 0])
    expect(wf['73'].inputs.images).toEqual(['grain:film', 0])
  })
})
