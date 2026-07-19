import type { WorkflowDefinition, GenerationParams } from '@/types/workflow'
import type { ComfyUIPrompt } from '@/types/comfyui'
import baseWorkflow from '../../../workflows/image_z_image_turbo.json'
import { appendFaceDetailer } from './face-detailer'
import { appendFaceSwap } from './face-swap'
import { appendFilmGrain } from './film-grain'
import { appendHiresFix } from './hires-fix'
import { appendImg2Img } from './img2img'
import { appendZImageControlNet } from './zimage-controlnet'

export const zImageTurboWorkflow: WorkflowDefinition = {
  id: 'z-image-turbo',
  name: 'Z Image Turbo',
  description: 'Fast turbo-style generation with optional 1.5× upscale and face swap',
  supportsNegativePrompt: false,
  supportsLoRA: true,
  supportsPromptEnhancer: false,
  supportsInputImage: true,
  supportsUpscale: true,
  supportsDetailer: true,
  supportsImg2Img: true,
  supportsControlNet: true,
  controlNetKind: 'zimage-fun',
  supportsIpAdapter: false,
  ariaModelKind: 'unet',
  aspectRatios: [
    { label: 'Portrait 2:3', width: 832, height: 1216 },
    { label: 'Story 9:16', width: 768, height: 1344 },
    { label: 'Square 1:1', width: 1024, height: 1024 },
    { label: 'Landscape 3:2', width: 1216, height: 832 },
    { label: 'Wide 16:9', width: 1344, height: 768 },
  ],
  defaultParams: {
    width: 832,
    height: 1216,
    seed: -1,
    upscale: true,
  },
  buildPrompt(params: GenerationParams): ComfyUIPrompt {
    const wf = JSON.parse(JSON.stringify(baseWorkflow)) as ComfyUIPrompt

    // Prompt
    wf['57:27'].inputs.text = params.prompt

    // Resolution + parallel batch (latent batch_size, capped at 4)
    wf['57:13'].inputs.width = String(params.width)
    wf['57:13'].inputs.height = String(params.height)
    wf['57:13'].inputs.batch_size = Math.max(1, Math.min(4, Math.round(params.batchSize ?? 1)))

    // Seed
    wf['57:3'].inputs.seed = String(params.seed < 0 ? Math.floor(Math.random() * 9999999999999) : params.seed)

    // LoRA stack — always write both slots explicitly (selected name or the
    // "None" sentinel the rgthree stack expects). Writing unconditionally, rather
    // than only when a LoRA is picked, prevents a stale name baked into the
    // template JSON from leaking through an empty slot into the submitted prompt.
    wf['57:62'].inputs.lora_01 = params.lora1 || 'None'
    wf['57:62'].inputs.strength_01 = String(params.lora1Strength ?? 1)
    wf['57:62'].inputs.lora_02 = params.lora2 || 'None'
    wf['57:62'].inputs.strength_02 = String(params.lora2Strength ?? 1)

    // Aria/Patreon model: z-image Aria models are full UNET diffusion-model
    // fine-tunes, so a selected one replaces the base UNET (UNETLoader) rather
    // than stacking as a LoRA. Base CLIP/VAE loaders are untouched.
    if (params.ariaModel) {
      wf['57:28'].inputs.unet_name = params.ariaModel
    }

    // Base-image modes (img2img/inpaint/outpaint): rewire the KSampler's latent
    // from the empty latent to a VAE-encoded source. No-op for txt2img. Returns
    // the image ref downstream passes read — the outpaint seam-removal composite
    // in outpaint mode, else the plain decode (['57:8', 0]).
    const decoded = appendImg2Img(wf, params, { ksamplerId: '57:3', vae: ['57:29', 0], decoded: ['57:8', 0] })

    // ControlNet (Z-Image Fun Union path): patches the KSampler's model via
    // ModelPatchLoader + QwenImageDiffsynthControlnet. Reads the sampler's
    // current model so it composes with the LoRA tail + img2img. Main pass only.
    appendZImageControlNet(wf, params, { ksamplerId: '57:3', vae: ['57:29', 0] })

    // Face swap (ReActor) is applied LAST — after hires-fix + detailer — because
    // a latent resample / face redraw re-diffuses the face from the scene prompt
    // and erodes the swapped identity. We only need to know up front whether it
    // is active; the actual nodes are appended after the diffusion passes below.
    const faceFromModel = params.faceSwapSource === 'model'
    const faceSwapActive = Boolean(
      params.faceSwap && (faceFromModel ? params.faceModel : params.inputImage),
    )

    // Hires-fix and the detailer operate on the plain generated (pre-swap)
    // image (`decoded`, above); the swap is layered on at the very end.

    // The legacy ESRGAN-only upscale nodes are always replaced by the latent
    // hires-fix below.
    delete wf['120']
    delete wf['121']
    delete wf['122']
    wf['9'].inputs.images = decoded

    // Latent hires-fix (optional, on by default): ESRGAN upscale → re-encode →
    // low-denoise resample for genuine added detail at net 1.5×. Turbo model:
    // keep the native 8 steps / cfg 1.
    if (params.upscale !== false) {
      appendHiresFix(wf, {
        saveNodeId: '9',
        imageSource: decoded,
        model: ['57:11', 0],
        positive: ['57:27', 0],
        negative: ['57:33', 0],
        vae: ['57:29', 0],
        upscaleModel: '4x-UltraSharp.pth',
        netScale: 1.5,
        modelScale: 4,
        sampler: {
          steps: 8,
          cfg: 1,
          sampler_name: 'res_multistep',
          scheduler: 'simple',
          denoise: 0.2,
          seed: params.seed < 0 ? Math.floor(Math.random() * 9999999999999) : params.seed,
        },
      })
    }

    // Face detailer (optional, on by default): detect-crop-redraw-paste over faces.
    if (params.detailer !== false) {
      appendFaceDetailer(wf, {
        saveNodeId: '9',
        model: ['57:11', 0],
        clip: ['57:62', 1],
        vae: ['57:29', 0],
        positive: ['57:27', 0],
        negative: ['57:33', 0],
        sampler: { steps: 8, cfg: 1, sampler_name: 'res_multistep', scheduler: 'simple', denoise: 0.25 },
      })
    }

    // FaceFusion-grade swap (mask + color-match + tuned enhancer), applied last
    // so the swapped identity survives the diffusion passes above.
    if (faceSwapActive) {
      appendFaceSwap(wf, {
        saveNodeId: '9',
        ...(faceFromModel
          ? { faceModelName: params.faceModel! }
          : { faceFilename: params.inputImage! }),
        swapModel: params.faceSwapModel,
        pixelBoost: params.faceSwapPixelBoost,
        pixelBoostSize: params.faceSwapPixelBoostSize,
      })
    }

    // Subtle photographic grain (photorealistic model): re-adds high-frequency
    // texture so skin reads as a photo rather than airbrushed. Runs dead last so
    // it grains the final upscale/detailer/swap output.
    appendFilmGrain(wf, '9', { intensity: 0.04 })

    return wf
  },
}
