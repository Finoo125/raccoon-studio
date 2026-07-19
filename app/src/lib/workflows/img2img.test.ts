import { describe, it, expect } from 'vitest'
import type { ComfyUIPrompt } from '@/types/comfyui'
import type { GenerationParams } from '@/types/workflow'
import { appendImg2Img } from './img2img'

// Minimal stand-in graph: a KSampler reading an empty latent + a vae source.
function baseGraph(): ComfyUIPrompt {
  return {
    ks: { class_type: 'KSampler', inputs: { steps: 8, denoise: 1, latent_image: ['empty', 0], model: ['unet', 0] } },
    unet: { class_type: 'UNETLoader', inputs: { unet_name: 'm.safetensors' } },
    empty: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
  } as unknown as ComfyUIPrompt
}
const refs = { ksamplerId: 'ks', vae: ['vae', 0] as [string, number], decoded: ['dec', 0] as [string, number] }
const p = (over: Partial<GenerationParams>): GenerationParams =>
  ({ prompt: 'x', width: 512, height: 512, seed: 1, ...over } as GenerationParams)

describe('appendImg2Img', () => {
  it('is a no-op without a base image', () => {
    const wf = baseGraph()
    appendImg2Img(wf, p({}), refs)
    expect(wf['i2i:load']).toBeUndefined()
    expect(wf.ks.inputs.latent_image).toEqual(['empty', 0])
  })

  it('img2img: encodes the base image and sets denoise', () => {
    const wf = baseGraph()
    appendImg2Img(wf, p({ baseImage: 'b.png', editMode: 'img2img', denoise: 0.5 }), refs)
    expect(wf['i2i:load'].inputs.image).toBe('b.png')
    expect(wf['i2i:encode'].inputs.pixels).toEqual(['i2i:load', 0])
    expect(wf['i2i:encode'].inputs.vae).toEqual(['vae', 0])
    expect(wf.ks.inputs.latent_image).toEqual(['i2i:encode', 0])
    expect(wf.ks.inputs.denoise).toBe(0.5)
  })

  it('img2img: defaults denoise to 0.65', () => {
    const wf = baseGraph()
    appendImg2Img(wf, p({ baseImage: 'b.png' }), refs)
    expect(wf.ks.inputs.denoise).toBe(0.65)
  })

  it('inpaint: adds mask + SetLatentNoiseMask between encode and sampler', () => {
    const wf = baseGraph()
    appendImg2Img(wf, p({ baseImage: 'b.png', editMode: 'inpaint', maskImage: 'm.png' }), refs)
    expect(wf['i2i:mask'].inputs.image).toBe('m.png')
    expect(wf['i2i:mask'].inputs.channel).toBe('red')
    expect(wf['i2i:setmask'].inputs.samples).toEqual(['i2i:encode', 0])
    expect(wf['i2i:setmask'].inputs.mask).toEqual(['i2i:mask', 0])
    expect(wf.ks.inputs.latent_image).toEqual(['i2i:setmask', 0])
  })

  it('outpaint: pads the image, masks the new area, and encodes the content seed', () => {
    const wf = baseGraph()
    appendImg2Img(wf, p({ baseImage: 'b.png', editMode: 'outpaint', outpaint: { left: 0, top: 0, right: 128, bottom: 0, feather: 24 } }), refs)
    expect(wf['i2i:pad'].inputs.right).toBe(128)
    expect(wf['i2i:pad'].inputs.feathering).toBe(24)
    // Encode the content seed, not the raw grey pad.
    expect(wf['i2i:encode'].inputs.pixels).toEqual(['i2i:seed', 0])
    expect(wf['i2i:setmask'].inputs.mask).toEqual(['i2i:pad', 1])
    expect(wf.ks.inputs.latent_image).toEqual(['i2i:setmask', 0])
  })

  it('outpaint: seeds the new region with a stretched+blurred copy of the original', () => {
    const wf = baseGraph()
    appendImg2Img(wf, p({ baseImage: 'b.png', editMode: 'outpaint', outpaint: { left: 0, top: 0, right: 128, bottom: 0, feather: 24 } }), refs)
    // Padded canvas size drives the stretch.
    expect(wf['i2i:padsize'].class_type).toBe('GetImageSize')
    expect(wf['i2i:padsize'].inputs.image).toEqual(['i2i:pad', 0])
    // Stretch the original to fill the whole padded canvas.
    expect(wf['i2i:seedscale'].class_type).toBe('ImageScale')
    expect(wf['i2i:seedscale'].inputs.image).toEqual(['i2i:load', 0])
    expect(wf['i2i:seedscale'].inputs.width).toEqual(['i2i:padsize', 0])
    expect(wf['i2i:seedscale'].inputs.height).toEqual(['i2i:padsize', 1])
    // Blur into a smooth colour field.
    expect(wf['i2i:seedblur'].class_type).toBe('ImageBlur')
    expect(wf['i2i:seedblur'].inputs.image).toEqual(['i2i:seedscale', 0])
    // Paste the true original back over the old area so only the NEW region is seeded.
    expect(wf['i2i:seed'].class_type).toBe('ImageCompositeMasked')
    expect(wf['i2i:seed'].inputs.destination).toEqual(['i2i:seedblur', 0])
    expect(wf['i2i:seed'].inputs.source).toEqual(['i2i:pad', 0])
    expect(wf['i2i:seed'].inputs.mask).toEqual(['i2i:invmask', 0])
  })

  it('outpaint: refines the seed at a partial denoise and bumps the step count', () => {
    const wf = baseGraph()
    appendImg2Img(wf, p({ baseImage: 'b.png', editMode: 'outpaint', outpaint: { left: 0, top: 0, right: 128, bottom: 0, feather: 24 } }), refs)
    // Partial denoise (refine the seed) rather than a full from-noise denoise.
    expect(wf.ks.inputs.denoise).toBeGreaterThan(0)
    expect(wf.ks.inputs.denoise).toBeLessThan(1)
    // A longer refinement schedule than the base turbo 8 steps.
    expect(wf.ks.inputs.steps).toBeGreaterThan(8)
  })

  it('outpaint: ignores a leftover params.denoise from a prior img2img/inpaint session', () => {
    const wf = baseGraph()
    // The Strength slider writes params.denoise and is hidden (not reset) when
    // the form switches to the Outpaint tab — a stale value must not survive.
    appendImg2Img(wf, p({ baseImage: 'b.png', editMode: 'outpaint', denoise: 0.35, outpaint: { left: 0, top: 0, right: 128, bottom: 0, feather: 24 } }), refs)
    expect(wf.ks.inputs.denoise).not.toBe(0.35)
  })

  it('inpaint/outpaint: does not touch the sampler model (no Differential Diffusion)', () => {
    const wf = baseGraph()
    appendImg2Img(wf, p({ baseImage: 'b.png', editMode: 'outpaint', outpaint: { left: 0, top: 0, right: 128, bottom: 0, feather: 24 } }), refs)
    expect(wf['i2i:diffdiff']).toBeUndefined()
    expect(wf.ks.inputs.model).toEqual(['unet', 0])
  })

  it('outpaint: composites the true original back over the decoded image to kill the seam', () => {
    const wf = baseGraph()
    const out = appendImg2Img(wf, p({ baseImage: 'b.png', editMode: 'outpaint', outpaint: { left: 0, top: 0, right: 128, bottom: 0, feather: 24 } }), refs)
    // Invert the pad mask (white in the NEW area) so the composite paints the
    // OLD area with the original pixels.
    expect(wf['i2i:invmask'].class_type).toBe('InvertMask')
    expect(wf['i2i:invmask'].inputs.mask).toEqual(['i2i:pad', 1])
    // Composite the padded original (output 0 = true original in the centre)
    // over the family's decoded image, feathered by the pad mask.
    expect(wf['i2i:composite'].class_type).toBe('ImageCompositeMasked')
    // Destination is the colour-matched generation (see the colour-match test).
    expect(wf['i2i:composite'].inputs.destination).toEqual(['i2i:colormatch', 0])
    expect(wf['i2i:composite'].inputs.source).toEqual(['i2i:pad', 0])
    expect(wf['i2i:composite'].inputs.mask).toEqual(['i2i:invmask', 0])
    expect(wf['i2i:composite'].inputs.x).toBe(0)
    expect(wf['i2i:composite'].inputs.y).toBe(0)
    // Downstream passes must read the composite, not the raw decode.
    expect(out).toEqual(['i2i:composite', 0])
  })

  it('outpaint: colour-matches the generated strips to the original before restoring', () => {
    const wf = baseGraph()
    const out = appendImg2Img(wf, p({ baseImage: 'b.png', editMode: 'outpaint', outpaint: { left: 0, top: 0, right: 128, bottom: 0, feather: 24 } }), refs)
    // Normalise the generated image's exposure/white-balance to the original so
    // the boundary has no tonal step for the feather to reveal.
    expect(wf['i2i:colormatch'].class_type).toBe('ColorMatchV2')
    expect(wf['i2i:colormatch'].inputs.image_target).toEqual(['dec', 0])
    expect(wf['i2i:colormatch'].inputs.image_ref).toEqual(['i2i:load', 0])
    // The restore composite sits on top of the colour-matched image.
    expect(wf['i2i:composite'].inputs.destination).toEqual(['i2i:colormatch', 0])
    expect(out).toEqual(['i2i:composite', 0])
  })

  it('img2img/inpaint/txt2img: return the decoded ref unchanged and add no composite', () => {
    for (const params of [
      p({}),
      p({ baseImage: 'b.png', editMode: 'img2img' }),
      p({ baseImage: 'b.png', editMode: 'inpaint', maskImage: 'm.png' }),
    ]) {
      const wf = baseGraph()
      const out = appendImg2Img(wf, params, refs)
      expect(out).toEqual(['dec', 0])
      expect(wf['i2i:composite']).toBeUndefined()
      expect(wf['i2i:invmask']).toBeUndefined()
    }
  })
})
