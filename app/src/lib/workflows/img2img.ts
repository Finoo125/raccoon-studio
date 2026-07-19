import type { ComfyUIPrompt } from '@/types/comfyui'
import type { GenerationParams } from '@/types/workflow'

/**
 * Outpaint refines a content seed (a stretched+blurred copy of the source) rather
 * than hallucinating the new region from flat grey + full noise, so it runs at a
 * PARTIAL denoise: high enough to repaint real detail, low enough to keep the
 * seed's colour/lighting/horizon structure. Full denoise here would discard the
 * seed and bring back the washed-out, out-of-focus expansions the seed exists to fix.
 */
const OUTPAINT_DENOISE = 0.82
/**
 * Turbo bases run ~8 fast steps tuned for txt2img; a large from-seed outpaint
 * benefits from a longer refinement schedule. Applied as a multiplier so each
 * family keeps its own base step count.
 */
const OUTPAINT_STEP_MULTIPLIER = 1.75
/**
 * The generated strips can land at a slightly different exposure/white-balance
 * than the source, leaving a faint tonal step at the boundary that the feather
 * only spreads, not removes. ColorMatchV2 (mkl) normalises the decoded image to
 * the original before the restore composite. Partial strength: enough to erase
 * the step without flattening genuinely new colours in the expansion.
 */
const OUTPAINT_COLORMATCH_STRENGTH = 0.6

export interface Img2ImgRefs {
  /** The family's KSampler node id (its `latent_image` is rewired, `denoise` set). */
  ksamplerId: string
  /** VAE source ref — same node that feeds the family's VAEDecode.vae. */
  vae: [string, number]
  /**
   * The family's decoded-image ref (the VAEDecode output the hires / detailer /
   * face-swap passes read). Outpaint composites the untouched original back over
   * this to remove the seam; the returned ref then points at the composite.
   */
  decoded: [string, number]
}

/**
 * Rewires a workflow from txt2img to a base-image mode (img2img / inpaint /
 * outpaint) when `params.baseImage` is set. Inserts a LoadImage → VAEEncode
 * branch and points the family's KSampler at it (via SetLatentNoiseMask for the
 * masked modes), and sets the sampler denoise. Node ids use an `i2i:` prefix to
 * avoid collisions. Mutates `wf`; a no-op when `baseImage` is absent.
 *
 * Must run BEFORE the hires/detailer/face-swap appends, which read the decoded
 * image rather than the latent. Returns the image ref those downstream passes
 * should read: the outpaint composite when in outpaint mode, else `refs.decoded`
 * unchanged.
 */
export function appendImg2Img(wf: ComfyUIPrompt, params: GenerationParams, refs: Img2ImgRefs): [string, number] {
  if (!params.baseImage) return refs.decoded
  const { ksamplerId, vae } = refs
  const mode = params.editMode ?? 'img2img'
  const ksampler = wf[ksamplerId]

  wf['i2i:load'] = {
    class_type: 'LoadImage',
    inputs: { image: params.baseImage, upload: 'image' },
  }

  // Pixels to encode: the content seed for outpaint, else the loaded image.
  let pixels: [string, number] = ['i2i:load', 0]

  if (mode === 'outpaint') {
    const o = params.outpaint ?? { left: 0, top: 0, right: 0, bottom: 0, feather: 24 }
    wf['i2i:pad'] = {
      class_type: 'ImagePadForOutpaint',
      inputs: {
        image: ['i2i:load', 0],
        left: o.left, top: o.top, right: o.right, bottom: o.bottom,
        feathering: o.feather,
      },
    }
    // Old-area mask (white where the original sits, feathered just inside its
    // edge). Built here because both the content seed and the post-decode restore
    // composite need it.
    wf['i2i:invmask'] = { class_type: 'InvertMask', inputs: { mask: ['i2i:pad', 1] } }

    // Content seed for the new region. ImagePadForOutpaint fills the new area
    // with flat 0.5 grey, so a full-denoise pass has to invent everything from
    // noise — on the 8-step turbo bases that yields soft, washed-out, out-of-
    // focus expansions. Instead, stretch the ORIGINAL across the whole padded
    // canvas and blur it into a smooth colour field: this hands the model the
    // scene's vertical structure (sky at top, horizon, ground at the bottom) in
    // roughly the right colours and positions. Paste the true original back over
    // the old area so only the NEW region carries the seed. A partial denoise
    // then refines this into detail that matches the source far better than a
    // from-noise guess. GetImageSize feeds the padded dimensions so this works
    // for any pad amounts without knowing the upload's pixel size up front.
    wf['i2i:padsize'] = { class_type: 'GetImageSize', inputs: { image: ['i2i:pad', 0] } }
    wf['i2i:seedscale'] = {
      class_type: 'ImageScale',
      inputs: {
        image: ['i2i:load', 0],
        upscale_method: 'bilinear',
        width: ['i2i:padsize', 0],
        height: ['i2i:padsize', 1],
        crop: 'disabled',
      },
    }
    wf['i2i:seedblur'] = {
      class_type: 'ImageBlur',
      inputs: { image: ['i2i:seedscale', 0], blur_radius: 31, sigma: 10 },
    }
    wf['i2i:seed'] = {
      class_type: 'ImageCompositeMasked',
      inputs: {
        destination: ['i2i:seedblur', 0],
        source: ['i2i:pad', 0],
        x: 0,
        y: 0,
        resize_source: false,
        mask: ['i2i:invmask', 0],
      },
    }
    pixels = ['i2i:seed', 0]
  }

  wf['i2i:encode'] = {
    class_type: 'VAEEncode',
    inputs: { pixels, vae },
  }

  if (mode === 'img2img') {
    ksampler.inputs.latent_image = ['i2i:encode', 0]
    ksampler.inputs.denoise = params.denoise ?? 0.65
    return refs.decoded
  }

  // inpaint / outpaint: restrict diffusion to the masked region. Tried wrapping
  // the model in Differential Diffusion here (the documented approach for masked
  // Flux-family generation) — on this app's turbo graphs (8-step schedule + a
  // ModelSamplingAuraFlow shift patch ahead of it) it made things worse, leaving
  // an inconsistent mix of untouched pixels and undenoised noise. Core ComfyUI's
  // plain mask blend (comfy/samplers.py KSamplerX0Inpaint.__call__) already runs
  // every step from the raw mask with no schedule dependency, so it isn't needed.
  // Don't re-add it without a live test against the turbo families.
  const mask: [string, number] =
    mode === 'outpaint'
      ? ['i2i:pad', 1] // ImagePadForOutpaint's second output is the new-area mask
      : ['i2i:mask', 0]

  if (mode === 'inpaint') {
    wf['i2i:mask'] = {
      class_type: 'LoadImageMask',
      inputs: { image: params.maskImage ?? params.baseImage, channel: 'red' },
    }
  }

  wf['i2i:setmask'] = {
    class_type: 'SetLatentNoiseMask',
    inputs: { samples: ['i2i:encode', 0], mask },
  }
  ksampler.inputs.latent_image = ['i2i:setmask', 0]

  if (mode !== 'outpaint') {
    ksampler.inputs.denoise = params.denoise ?? 0.65
    return refs.decoded
  }

  // Outpaint refines the content seed built above, so it runs at a fixed partial
  // denoise (see OUTPAINT_DENOISE). params.denoise belongs to the hidden
  // img2img/inpaint Strength slider and must not leak in when the form is left on
  // a stale value, so it is ignored here outright.
  ksampler.inputs.denoise = OUTPAINT_DENOISE
  // More refinement steps for the large from-seed region than the turbo base's
  // fast schedule. Guard on a numeric steps input so a family whose sampler node
  // has none is left untouched.
  const baseSteps = Number(ksampler.inputs.steps)
  if (Number.isFinite(baseSteps) && baseSteps > 0) {
    ksampler.inputs.steps = Math.round(baseSteps * OUTPAINT_STEP_MULTIPLIER)
  }

  // Tonal match. Even with the seam gone, the generated strips can sit at a
  // slightly different exposure/white-balance than the source, so the boundary
  // shows a faint vertical line the feather can only soften. Normalise the whole
  // decoded image toward the original's colour distribution first; the restore
  // composite below then keeps the old region pixel-exact anyway, so this mainly
  // corrects the new strips.
  wf['i2i:colormatch'] = {
    class_type: 'ColorMatchV2',
    inputs: {
      image_target: refs.decoded,
      image_ref: ['i2i:load', 0],
      method: 'mkl',
      strength: OUTPAINT_COLORMATCH_STRENGTH,
      multithread: true,
    },
  }

  // Seam removal. The whole padded image round-trips through VAE encode→decode
  // and the old/new blend happens in *latent* space, where the pixel feather
  // collapses to ~1/8 its width (VAE downscale) and even the untouched original
  // region comes back faintly VAE-degraded — that boundary mismatch is the
  // visible border. Fix: after decode, paste the TRUE original pixels back over
  // the old region using the same old-area mask (i2i:invmask) built above — its
  // feather band sits inside the original, so the blend is original↔generated
  // (never seed↔generated), leaving the old region pixel-identical and only a
  // soft seam bleeding into the fresh expansion.
  wf['i2i:composite'] = {
    class_type: 'ImageCompositeMasked',
    inputs: {
      destination: ['i2i:colormatch', 0],
      source: ['i2i:pad', 0],
      x: 0,
      y: 0,
      resize_source: false,
      mask: ['i2i:invmask', 0],
    },
  }
  return ['i2i:composite', 0]
}
