import type { WorkflowDefinition, GenerationParams } from '@/types/workflow'
import type { ComfyUIPrompt } from '@/types/comfyui'
import baseWorkflow from '../../../workflows/image_ernie_image_turbo.json'
import { appendFaceDetailer } from './face-detailer'
import { appendFaceSwap } from './face-swap'
import { appendFilmGrain } from './film-grain'
import { appendHiresFix } from './hires-fix'
import { appendImg2Img } from './img2img'

export const ernieTurboWorkflow: WorkflowDefinition = {
  id: 'ernie-turbo',
  name: 'Ernie Image Turbo',
  description: 'Fast photorealistic generation with optional 1.5× upscale and face swap',
  supportsNegativePrompt: false,
  supportsLoRA: true,
  supportsPromptEnhancer: true,
  supportsInputImage: true,
  supportsUpscale: true,
  supportsDetailer: true,
  supportsImg2Img: true,
  supportsControlNet: false,
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
    promptEnhancer: false,
    upscale: true,
  },
  buildPrompt(params: GenerationParams): ComfyUIPrompt {
    const wf = JSON.parse(JSON.stringify(baseWorkflow)) as ComfyUIPrompt

    // Main prompt
    wf['88:94'].inputs.value = params.prompt

    // Resolution + parallel batch (latent batch_size, capped at 4)
    wf['88:71'].inputs.width = String(params.width)
    wf['88:71'].inputs.height = String(params.height)
    wf['88:71'].inputs.batch_size = Math.max(1, Math.min(4, Math.round(params.batchSize ?? 1)))

    // Seed
    wf['88:70'].inputs.seed = String(params.seed < 0 ? Math.floor(Math.random() * 9999999999999) : params.seed)

    // Prompt enhancer toggle. Must be a real boolean: ComfyUI coerces BOOLEAN
    // inputs with bool(val), and bool("false") is True — a stringified "false"
    // would leave the enhancer permanently on.
    wf['88:96'].inputs.value = params.promptEnhancer === true

    // LoRA stack (slots 01-04) — always write slots 01/02 explicitly (selected
    // name or the "None" sentinel) so a stale name baked into the template JSON
    // can't leak through an empty slot into the submitted prompt.
    wf['88:104'].inputs.lora_01 = params.lora1 || 'None'
    wf['88:104'].inputs.strength_01 = String(params.lora1Strength ?? 0.9)
    wf['88:104'].inputs.lora_02 = params.lora2 || 'None'
    wf['88:104'].inputs.strength_02 = String(params.lora2Strength ?? 0.9)

    // Aria/Patreon model: a full UNET diffusion-model fine-tune replaces the
    // base UNET (UNETLoader); base CLIP/VAE loaders are untouched.
    if (params.ariaModel) {
      wf['88:66'].inputs.unet_name = params.ariaModel
    }

    // Base-image modes (img2img/inpaint/outpaint). No-op for txt2img. Returns
    // the image ref downstream passes read — the outpaint seam-removal composite
    // in outpaint mode, else the plain decode (['88:65', 0]).
    const decoded = appendImg2Img(wf, params, { ksamplerId: '88:70', vae: ['88:63', 0], decoded: ['88:65', 0] })

    // Face swap (ReActor) is applied LAST — after hires-fix + detailer — so the
    // swapped identity is not eroded by a latent resample / face redraw. We only
    // need to know up front whether it is active.
    const faceFromModel = params.faceSwapSource === 'model'
    const faceSwapActive = Boolean(
      params.faceSwap && (faceFromModel ? params.faceModel : params.inputImage),
    )

    // Hires-fix and the detailer operate on the plain decoded image (`decoded`, above).

    // The legacy ESRGAN-only upscale nodes are always replaced by the latent
    // hires-fix below.
    delete wf['117']
    delete wf['118']
    delete wf['119']
    wf['73'].inputs.images = decoded

    // Latent hires-fix (optional, on by default): ESRGAN upscale → re-encode →
    // low-denoise resample for genuine added detail at net 1.5×. Turbo model:
    // keep the native 8 steps / cfg 1.
    if (params.upscale !== false) {
      appendHiresFix(wf, {
        saveNodeId: '73',
        imageSource: decoded,
        model: ['88:104', 0],
        positive: ['88:67', 0],
        negative: ['88:91', 0],
        vae: ['88:63', 0],
        upscaleModel: '4x-UltraSharp.pth',
        netScale: 1.5,
        modelScale: 4,
        sampler: {
          steps: 8,
          cfg: 1,
          sampler_name: 'euler',
          scheduler: 'simple',
          denoise: 0.2,
          seed: params.seed < 0 ? Math.floor(Math.random() * 9999999999999) : params.seed,
        },
      })
    }

    // Face detailer (optional, on by default): detect-crop-redraw-paste over faces.
    if (params.detailer !== false) {
      appendFaceDetailer(wf, {
        saveNodeId: '73',
        model: ['88:104', 0],
        clip: ['88:104', 1],
        vae: ['88:63', 0],
        positive: ['88:67', 0],
        negative: ['88:91', 0],
        sampler: { steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 0.25 },
      })
    }

    // FaceFusion-grade swap (mask + color-match + tuned enhancer), applied last
    // so the swapped identity survives the diffusion passes above.
    if (faceSwapActive) {
      appendFaceSwap(wf, {
        saveNodeId: '73',
        ...(faceFromModel
          ? { faceModelName: params.faceModel! }
          : { faceFilename: params.inputImage! }),
        swapModel: params.faceSwapModel,
        pixelBoost: params.faceSwapPixelBoost,
        pixelBoostSize: params.faceSwapPixelBoostSize,
      })
    }

    // Subtle photographic grain (photorealistic model): re-adds high-frequency
    // texture so skin reads as a photo rather than airbrushed. Runs last so it
    // grains the final detailer/upscale/swap output.
    appendFilmGrain(wf, '73', { intensity: 0.04 })

    return wf
  },
}
