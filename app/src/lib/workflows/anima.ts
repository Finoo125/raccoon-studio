import type { WorkflowDefinition, GenerationParams } from '@/types/workflow'
import type { ComfyUIPrompt } from '@/types/comfyui'
import baseWorkflow from '../../../workflows/image_anima_preview.json'
import { appendFaceDetailer } from './face-detailer'
import { appendHiresFix } from './hires-fix'
import { appendImg2Img } from './img2img'
import { ANIMA_DEFAULT_POSITIVE, ANIMA_DEFAULT_NEGATIVE } from './anime-prompts'

/**
 * The two Anima checkpoints run the same graph and differ only in the file they
 * load and the sampler budget, so one factory builds both:
 *  - Aesthetic — the full model. The card's 30 steps / CFG 4, er_sde.
 *  - Turbo — distilled: CFG 1 and 8–12 steps, and the card recommends euler for
 *    it (er_sde injects noise every step, which fights the distillation at that
 *    step count). Negative prompts are dead weight at CFG 1 — the sampler skips
 *    the uncond pass entirely — so that family hides the box.
 * `steps` on the hires-fix/detailer passes is the schedule length, not the work
 * done: ComfyUI slices it by `denoise`, so those numbers are sized to land ~2–3
 * real steps per pass for both families.
 */
interface AnimaVariant {
  id: string
  name: string
  description: string
  unet: string
  negativePrompt: boolean
  sampler: string
  cfg: number
  steps: number
  hiresSteps: number
  detailerSteps: number
}

function animaFamily(v: AnimaVariant): WorkflowDefinition {
  return {
    id: v.id,
    name: v.name,
    description: v.description,
    supportsNegativePrompt: v.negativePrompt,
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
      negativePrompt: v.negativePrompt ? ANIMA_DEFAULT_NEGATIVE : '',
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

      // Checkpoint + its sampler budget. Written from the variant rather than
      // left to the template JSON so the two families can never inherit each
      // other's steps/CFG (a Turbo run at CFG 4 is a burnt image).
      wf['60:44'].inputs.unet_name = v.unet
      wf['60:19'].inputs.steps = v.steps
      wf['60:19'].inputs.cfg = v.cfg
      wf['60:19'].inputs.sampler_name = v.sampler

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
            steps: v.hiresSteps,
            cfg: v.cfg,
            sampler_name: v.sampler,
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
          sampler: { steps: v.detailerSteps, cfg: v.cfg, sampler_name: v.sampler, scheduler: 'simple', denoise: 0.15 },
        })
      }

      return wf
    },
  }
}

export const animaWorkflow = animaFamily({
  id: 'anima',
  name: 'Anima',
  description: 'Anime-style illustration (Anima Aesthetic v1.1 by CircleStone Labs) with optional 1.5× upscale',
  unet: 'anima-aesthetic-v1.1.safetensors',
  negativePrompt: true,
  sampler: 'er_sde',
  cfg: 4,
  steps: 30,
  hiresSteps: 12,
  detailerSteps: 30,
})

export const animaTurboWorkflow = animaFamily({
  id: 'anima-turbo',
  name: 'Anima Turbo',
  description: 'Distilled Anima — same look, ~3× fewer steps (CFG 1, euler)',
  unet: 'anima-turbo-v1.0.safetensors',
  negativePrompt: false,
  sampler: 'euler',
  cfg: 1,
  steps: 10,
  hiresSteps: 10,
  detailerSteps: 20,
})
