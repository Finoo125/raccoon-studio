import type { ComfyUIPrompt } from '@/types/comfyui'

export interface HiresFixRefs {
  saveNodeId: string
  /** The image to upscale (VAE-decoded output, or a post-face-swap source). */
  imageSource: [string, number]
  model: [string, number]
  positive: [string, number]
  negative: [string, number]
  vae: [string, number]
  /** ESRGAN upscale model filename (e.g. 4x-UltraSharp.pth). */
  upscaleModel: string
  /** Desired net upscale of the generated size (e.g. 1.5 → net 1.5×). */
  netScale: number
  /** The upscale model's native factor (e.g. 4 for a 4× model). */
  modelScale: number
  sampler: {
    steps: number
    cfg: number
    sampler_name: string
    scheduler: string
    /** Resample strength; low (~0.3) keeps composition while adding detail. */
    denoise: number
    seed: number
  }
}

/**
 * Appends a latent hires-fix pass before SaveImage: ESRGAN-upscale the image,
 * downscale to the target net factor, VAE-encode back to latent, then run a
 * low-denoise KSampler and decode. Unlike a pure ESRGAN upscale this genuinely
 * adds detail/coherence at the larger size.
 *
 * Runs before the face detailer / film grain, which wrap SaveImage afterwards
 * so they operate on the final-resolution image. Node IDs use a `hires:` prefix
 * to avoid collisions with numeric node IDs.
 */
export function appendHiresFix(wf: ComfyUIPrompt, refs: HiresFixRefs): void {
  const { saveNodeId, imageSource, model, positive, negative, vae, upscaleModel, netScale, modelScale, sampler } = refs

  wf['hires:upscale_model'] = {
    class_type: 'UpscaleModelLoader',
    inputs: { model_name: upscaleModel },
  }

  wf['hires:upscale'] = {
    class_type: 'ImageUpscaleWithModel',
    inputs: {
      upscale_model: ['hires:upscale_model', 0],
      image: imageSource,
    },
  }

  // The model enlarges by modelScale; downscale to land on the net target.
  wf['hires:scale'] = {
    class_type: 'ImageScaleBy',
    inputs: {
      upscale_method: 'lanczos',
      scale_by: netScale / modelScale,
      image: ['hires:upscale', 0],
    },
  }

  wf['hires:encode'] = {
    class_type: 'VAEEncode',
    inputs: {
      pixels: ['hires:scale', 0],
      vae,
    },
  }

  wf['hires:sample'] = {
    class_type: 'KSampler',
    inputs: {
      seed: sampler.seed,
      steps: sampler.steps,
      cfg: sampler.cfg,
      sampler_name: sampler.sampler_name,
      scheduler: sampler.scheduler,
      denoise: sampler.denoise,
      model,
      positive,
      negative,
      latent_image: ['hires:encode', 0],
    },
  }

  wf['hires:decode'] = {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['hires:sample', 0],
      vae,
    },
  }

  wf[saveNodeId].inputs.images = ['hires:decode', 0]
}
