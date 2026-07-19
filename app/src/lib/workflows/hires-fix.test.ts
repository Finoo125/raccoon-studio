import { describe, it, expect } from 'vitest'
import { appendHiresFix } from './hires-fix'
import type { ComfyUIPrompt } from '@/types/comfyui'

function makeWf(): ComfyUIPrompt {
  return {
    '99': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'test', images: ['decode', 0] },
    },
    decode: {
      class_type: 'VAEDecode',
      inputs: { samples: ['ksampler', 0], vae: ['ckpt', 2] },
    },
  }
}

const refs = {
  saveNodeId: '99',
  imageSource: ['decode', 0] as [string, number],
  model: ['ckpt', 0] as [string, number],
  positive: ['pos', 0] as [string, number],
  negative: ['neg', 0] as [string, number],
  vae: ['ckpt', 2] as [string, number],
  upscaleModel: '4x-UltraSharp.pth',
  netScale: 1.5,
  modelScale: 4,
  sampler: {
    steps: 12,
    cfg: 7,
    sampler_name: 'dpmpp_2m',
    scheduler: 'karras',
    denoise: 0.3,
    seed: 42,
  },
}

describe('appendHiresFix', () => {
  it('adds the full upscale → encode → resample → decode chain', () => {
    const wf = makeWf()
    appendHiresFix(wf, refs)
    expect(wf['hires:upscale_model'].class_type).toBe('UpscaleModelLoader')
    expect(wf['hires:upscale_model'].inputs.model_name).toBe('4x-UltraSharp.pth')
    expect(wf['hires:upscale'].class_type).toBe('ImageUpscaleWithModel')
    expect(wf['hires:scale'].class_type).toBe('ImageScaleBy')
    expect(wf['hires:encode'].class_type).toBe('VAEEncode')
    expect(wf['hires:sample'].class_type).toBe('KSampler')
    expect(wf['hires:decode'].class_type).toBe('VAEDecode')
  })

  it('feeds the upscale model + image source into ImageUpscaleWithModel', () => {
    const wf = makeWf()
    appendHiresFix(wf, refs)
    expect(wf['hires:upscale'].inputs.upscale_model).toEqual(['hires:upscale_model', 0])
    expect(wf['hires:upscale'].inputs.image).toEqual(['decode', 0])
  })

  it('downscales by netScale / modelScale (lanczos) to reach the net factor', () => {
    const wf = makeWf()
    appendHiresFix(wf, refs)
    expect(wf['hires:scale'].inputs.upscale_method).toBe('lanczos')
    expect(wf['hires:scale'].inputs.scale_by).toBeCloseTo(0.375)
    expect(wf['hires:scale'].inputs.image).toEqual(['hires:upscale', 0])
  })

  it('re-encodes the upscaled image to latent with the supplied vae', () => {
    const wf = makeWf()
    appendHiresFix(wf, refs)
    expect(wf['hires:encode'].inputs.pixels).toEqual(['hires:scale', 0])
    expect(wf['hires:encode'].inputs.vae).toEqual(['ckpt', 2])
  })

  it('resamples the latent with model/positive/negative and sampler settings', () => {
    const wf = makeWf()
    appendHiresFix(wf, refs)
    const s = wf['hires:sample'].inputs
    expect(s.model).toEqual(['ckpt', 0])
    expect(s.positive).toEqual(['pos', 0])
    expect(s.negative).toEqual(['neg', 0])
    expect(s.latent_image).toEqual(['hires:encode', 0])
    expect(s.steps).toBe(12)
    expect(s.cfg).toBe(7)
    expect(s.sampler_name).toBe('dpmpp_2m')
    expect(s.scheduler).toBe('karras')
    expect(s.denoise).toBe(0.3)
    expect(s.seed).toBe(42)
  })

  it('decodes the resampled latent and repoints SaveImage to it', () => {
    const wf = makeWf()
    appendHiresFix(wf, refs)
    expect(wf['hires:decode'].inputs.samples).toEqual(['hires:sample', 0])
    expect(wf['hires:decode'].inputs.vae).toEqual(['ckpt', 2])
    expect(wf['99'].inputs.images).toEqual(['hires:decode', 0])
  })
})
