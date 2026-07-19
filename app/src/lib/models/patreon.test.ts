import { describe, it, expect } from 'vitest'
import { patreonSubfolder, matchesPatreonPreset } from './patreon'

describe('patreonSubfolder', () => {
  it('routes SDXL-family aria models to checkpoints', () => {
    expect(patreonSubfolder('aria_sdxl_realism.safetensors')).toBe('checkpoints')
    expect(patreonSubfolder('aria_pony_v2.safetensors')).toBe('checkpoints')
  })
  it('routes z-image / ernie / anima aria models to diffusion_models (full UNET models)', () => {
    expect(patreonSubfolder('aria_zit_01.safetensors')).toBe('diffusion_models')
    expect(patreonSubfolder('Aria_ERNIE_v3.safetensors')).toBe('diffusion_models')
    expect(patreonSubfolder('aria_anima_01.safetensors')).toBe('diffusion_models')
  })
  it('defaults an unrecognized aria name to checkpoints', () => {
    expect(patreonSubfolder('Aria_Realism_XL.safetensors')).toBe('checkpoints')
  })
  it('routes muscgi/muscgro models to loras', () => {
    expect(patreonSubfolder('muscgi_pack.safetensors')).toBe('loras')
    expect(patreonSubfolder('MUSCGRO_v2.safetensors')).toBe('loras')
  })
  it('falls back to loras for anything else', () => {
    expect(patreonSubfolder('random.safetensors')).toBe('loras')
  })
})

describe('matchesPatreonPreset', () => {
  it('matches a z-image aria lora to the z-image-turbo family', () => {
    expect(matchesPatreonPreset('aria_zit_01.safetensors', 'z-image-turbo')).toBe(true)
    expect(matchesPatreonPreset('aria_zit_01.safetensors', 'sdxl')).toBe(false)
  })
})
