import { describe, it, expect } from 'vitest'
import { hasBaseModel, comboOptions } from './installed'

const ckpt = (names: string[]) => ({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [names] } } } })
const unet = (names: string[]) => ({ UNETLoader: { input: { required: { unet_name: [names] } } } })

describe('hasBaseModel', () => {
  it('is false on a fresh install (both loaders offer nothing)', () => {
    expect(hasBaseModel(ckpt([]), unet([]))).toBe(false)
  })

  it('is true with only an SDXL-family checkpoint', () => {
    expect(hasBaseModel(ckpt(['ponyXL.safetensors']), unet([]))).toBe(true)
  })

  it('is true with only a diffusion model', () => {
    expect(hasBaseModel(ckpt([]), unet(['z-image.safetensors']))).toBe(true)
  })

  it('is false for error bodies (ComfyUI unreachable)', () => {
    expect(hasBaseModel({ error: 'ComfyUI unreachable' }, { error: 'ComfyUI unreachable' })).toBe(false)
    expect(hasBaseModel(null, undefined)).toBe(false)
  })
})

describe('comboOptions', () => {
  it('reads the classic [[...names], config] shape', () => {
    const data = { VAELoader: { input: { required: { vae_name: [['ae.safetensors'], {}] } } } }
    expect(comboOptions(data, 'VAELoader', 'vae_name')).toEqual(['ae.safetensors'])
  })

  // Verbatim from a live ComfyUI /object_info/LatentUpscaleModelLoader. Reading
  // [0] here gives the string 'COMBO', which spread into a Set becomes C,O,M,B —
  // so a file sitting in models/latent_upscale_models/ read as missing forever.
  it('reads the new schema API ["COMBO", { options }] shape', () => {
    const data = {
      LatentUpscaleModelLoader: {
        input: { required: { model_name: ['COMBO', { options: ['ltx-2.3-spatial-upscaler-x2-1.1.safetensors'] }] } },
      },
    }
    expect(comboOptions(data, 'LatentUpscaleModelLoader', 'model_name')).toEqual([
      'ltx-2.3-spatial-upscaler-x2-1.1.safetensors',
    ])
  })

  it('is an empty list for a missing node, field, or error body', () => {
    expect(comboOptions({}, 'LatentUpscaleModelLoader', 'model_name')).toEqual([])
    expect(comboOptions({ error: 'ComfyUI unreachable' }, 'VAELoader', 'vae_name')).toEqual([])
    expect(comboOptions(null, 'VAELoader', 'vae_name')).toEqual([])
    expect(comboOptions({ VAELoader: { input: { required: {} } } }, 'VAELoader', 'vae_name')).toEqual([])
  })

  it('is an empty list when the new shape carries no options', () => {
    const data = { UpscaleModelLoader: { input: { required: { model_name: ['COMBO', {}] } } } }
    expect(comboOptions(data, 'UpscaleModelLoader', 'model_name')).toEqual([])
  })
})
