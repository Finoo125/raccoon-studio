import type { WorkflowDefinition, GenerationParams } from '@/types/workflow'
import type { ComfyUIPrompt } from '@/types/comfyui'
import baseWorkflow from '../../../workflows/image_anima_preview.json'
import { appendFaceDetailer } from './face-detailer'
import { appendHiresFix } from './hires-fix'
import { appendImg2Img } from './img2img'
import { ANIMA_DEFAULT_POSITIVE, ANIMA_DEFAULT_NEGATIVE } from './anime-prompts'

export const animaWorkflow: WorkflowDefinition = {
  id: 'anima',
  name: 'Anima',
  description: 'Anime-style illustration (2B parameter model by CircleStone Labs) with optional 1.5× upscale',
  supportsNegativePrompt: true,
  supportsLoRA: true,
  supportsPromptEnhancer: false,
  supportsInputImage: false,
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
    prompt: ANIMA_DEFAULT_POSITIVE,
    negativePrompt: ANIMA_DEFAULT_NEGATIVE,
    upscale: true,
  },
  buildPrompt(params: GenerationParams): ComfyUIPrompt {
    const wf = JSON.parse(JSON.stringify(baseWorkflow)) as ComfyUIPrompt

    // Positive prompt
    wf['60:11'].inputs.text = params.prompt

    // Negative prompt
    if (params.negativePrompt !== undefined) {
      wf['60:12'].inputs.text = params.negativePrompt
    }

    // Resolution + parallel batch (latent batch_size, capped at 4)
    wf['60:28'].inputs.width = String(params.width)
    wf['60:28'].inputs.height = String(params.height)
    wf['60:28'].inputs.batch_size = Math.max(1, Math.min(4, Math.round(params.batchSize ?? 1)))

    // Seed (-1 → random large int)
    wf['60:19'].inputs.seed = String(params.seed < 0 ? Math.floor(Math.random() * 9999999999999) : params.seed)

    // Aria/Patreon model: a full UNET diffusion-model fine-tune replaces the
    // base UNET (UNETLoader); base CLIP/VAE loaders are untouched. A manual
    // LoRA (lora1) applies independently on the LoraLoaderModelOnly node below.
    if (params.ariaModel) {
      wf['60:44'].inputs.unet_name = params.ariaModel
    }

    // Base-image modes (img2img/inpaint/outpaint). No-op for txt2img. Returns
    // the image ref downstream passes read — the outpaint seam-removal composite
    // in outpaint mode, else the plain decode (['60:8', 0]).
    const decoded = appendImg2Img(wf, params, { ksamplerId: '60:19', vae: ['60:15', 0], decoded: ['60:8', 0] })

    // Manual LoRA (single slot). Node 60:61 is a LoraLoaderModelOnly, which —
    // unlike the rgthree stack — has no "None" sentinel and demands a real file,
    // and its template default points at a LoRA that may not be installed. So:
    // with a LoRA picked, set it; with none, bypass the node entirely (rewire the
    // model consumers straight to the UNETLoader and delete it) rather than ship
    // the stale default and fail ComfyUI validation. modelRef is the model source
    // for every downstream pass (sampler, hires-fix, detailer).
    let modelRef: [string, number] = ['60:61', 0]
    if (params.lora1) {
      wf['60:61'].inputs.lora_name = params.lora1
      wf['60:61'].inputs.strength_model = String(params.lora1Strength ?? 1)
    } else {
      modelRef = ['60:44', 0]
      wf['60:19'].inputs.model = modelRef
      delete wf['60:61']
    }

    // The legacy ESRGAN-only upscale nodes are always replaced by the latent
    // hires-fix below. (No clip skip here: Anima's text encoder is a Qwen LLM,
    // not a CLIP model, so CLIPSetLastLayer is not its trained convention.)
    delete wf['120']
    delete wf['121']
    delete wf['122']
    wf['46'].inputs.images = decoded

    // Latent hires-fix (optional, on by default): ESRGAN upscale → re-encode →
    // low-denoise resample for genuine added detail at net 1.5×.
    if (params.upscale !== false) {
      appendHiresFix(wf, {
        saveNodeId: '46',
        imageSource: decoded,
        model: modelRef,
        positive: ['60:11', 0],
        negative: ['60:12', 0],
        vae: ['60:15', 0],
        upscaleModel: '4x-AnimeSharp.pth',
        netScale: 1.5,
        modelScale: 4,
        sampler: {
          steps: 12,
          cfg: 4,
          sampler_name: 'er_sde',
          scheduler: 'simple',
          denoise: 0.2,
          seed: params.seed < 0 ? Math.floor(Math.random() * 9999999999999) : params.seed,
        },
      })
    }

    // Face detailer (optional, on by default): detect-crop-redraw-paste over faces.
    if (params.detailer !== false) {
      appendFaceDetailer(wf, {
        saveNodeId: '46',
        model: modelRef,
        clip: ['60:45', 0],
        vae: ['60:15', 0],
        positive: ['60:11', 0],
        negative: ['60:12', 0],
        sampler: { steps: 30, cfg: 4, sampler_name: 'er_sde', scheduler: 'simple', denoise: 0.15 },
      })
    }

    return wf
  },
}
