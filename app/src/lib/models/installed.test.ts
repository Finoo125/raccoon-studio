import { describe, it, expect } from 'vitest'
import { hasBaseModel } from './installed'

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
