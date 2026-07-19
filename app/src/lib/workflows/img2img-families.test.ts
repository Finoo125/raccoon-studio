import { describe, it, expect } from 'vitest'
import { workflows } from './index'
import type { GenerationParams } from '@/types/workflow'

// Integration guard: each real image family must actually rewire its KSampler
// onto the i2i chain when a base image is set (catches a wrong KSampler/VAE id
// that the stubbed helper test can't). Every family declares supportsImg2Img.
const base = (over: Partial<GenerationParams>): GenerationParams =>
  ({ prompt: 'x', width: 832, height: 1216, seed: 1, ...over } as GenerationParams)

describe('img2img wired into every image family', () => {
  for (const wf of workflows) {
    it(`${wf.id}: txt2img leaves no i2i nodes`, () => {
      const g = wf.buildPrompt(base({}))
      expect(g['i2i:encode']).toBeUndefined()
    })

    it(`${wf.id}: img2img inserts a VAEEncode and a sampler points at it`, () => {
      const g = wf.buildPrompt(base({ baseImage: 'b.png', editMode: 'img2img', denoise: 0.5 }))
      expect(g['i2i:load'].inputs.image).toBe('b.png')
      expect(g['i2i:encode'].class_type).toBe('VAEEncode')
      // Some sampler in the graph consumes the encoded latent (directly here).
      const consumers = Object.values(g).filter(
        (n) => Array.isArray((n.inputs as Record<string, unknown>).latent_image) &&
          ((n.inputs as { latent_image: [string, number] }).latent_image[0] === 'i2i:encode'),
      )
      expect(consumers.length).toBeGreaterThan(0)
    })

    it(`${wf.id}: inpaint inserts SetLatentNoiseMask`, () => {
      const g = wf.buildPrompt(base({ baseImage: 'b.png', editMode: 'inpaint', maskImage: 'm.png' }))
      expect(g['i2i:setmask'].class_type).toBe('SetLatentNoiseMask')
    })

    // The Strength slider (img2img/inpaint) and the outpaint tab share one
    // params.denoise field; the slider is hidden but not reset in outpaint
    // mode, so a value set earlier in the session must not survive — outpaint
    // uses its own fixed partial denoise to refine the content seed.
    it(`${wf.id}: outpaint uses a fixed partial denoise, ignoring a leftover params.denoise`, () => {
      const g = wf.buildPrompt(base({
        baseImage: 'b.png',
        editMode: 'outpaint',
        denoise: 0.35,
        outpaint: { left: 0, top: 0, right: 128, bottom: 0, feather: 24 },
      }))
      const samplers = Object.values(g).filter(
        (n) => Array.isArray((n.inputs as Record<string, unknown>).latent_image) &&
          ((n.inputs as { latent_image: [string, number] }).latent_image[0] === 'i2i:setmask'),
      )
      expect(samplers.length).toBeGreaterThan(0)
      for (const s of samplers) {
        expect(s.inputs.denoise).toBeGreaterThan(0)
        expect(s.inputs.denoise).toBeLessThan(1)
        expect(s.inputs.denoise).not.toBe(0.35)
      }
    })

    it(`${wf.id}: outpaint composites the original back and downstream reads it`, () => {
      const g = wf.buildPrompt(base({
        baseImage: 'b.png',
        editMode: 'outpaint',
        outpaint: { left: 0, top: 0, right: 128, bottom: 0, feather: 24 },
      }))
      // The seam-removal composite exists and pulls the true original pixels.
      expect(g['i2i:composite'].class_type).toBe('ImageCompositeMasked')
      expect(g['i2i:composite'].inputs.source).toEqual(['i2i:pad', 0])
      // Something downstream (save / hires-fix input) must read the composite,
      // proving the family rewired its decoded ref onto it rather than the raw decode.
      const consumers = Object.values(g).filter((n) =>
        Object.values(n.inputs as Record<string, unknown>).some(
          (v) => Array.isArray(v) && v[0] === 'i2i:composite',
        ),
      )
      expect(consumers.length).toBeGreaterThan(0)
    })
  }
})
