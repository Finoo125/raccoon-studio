import type { WorkflowDefinition, GenerationParams } from '@/types/workflow'
import type { ComfyUIPrompt } from '@/types/comfyui'
import baseWorkflow from '../../../workflows/image_sdxl.json'
import { appendFaceDetailer } from './face-detailer'
import { appendFaceSwap } from './face-swap'
import { appendFilmGrain } from './film-grain'
import { appendHiresFix } from './hires-fix'
import { appendImg2Img } from './img2img'
import { appendIpAdapter } from './ipadapter'
import { appendControlNet } from './controlnet'
import { ANIME_DEFAULT_POSITIVE, ANIME_DEFAULT_NEGATIVE, PONY_DEFAULT_POSITIVE, PONY_DEFAULT_NEGATIVE } from './anime-prompts'

/**
 * Dedicated SDXL VAE (madebyollin fp16-fix) the installer/Models tab drop into
 * models/vae/. Used in place of a checkpoint's baked VAE to fix washed-out /
 * desaturated colors (the classic SDXL fp16 VAE overflow, seen on Illustrious).
 * The form probes for this exact filename before setting params.sdxlVae, so the
 * name can't drift between the download and the lookup.
 */
export const SDXL_FIX_VAE = 'sdxl_vae.safetensors'

interface SdxlConfig {
  id: string
  name: string
  description: string
  /** Base checkpoint filename (overridden by a chosen Aria checkpoint). */
  checkpoint: string
  /** Prepended to the user's positive prompt at build time (kept empty now that
   *  the anime families seed their quality tags into the visible default box). */
  positivePrefix: string
  /** Visible positive-prompt box default. Empty for the photoreal base, which
   *  starts from a blank prompt; the anime families seed booru quality tags. */
  defaultPositive: string
  defaultNegative: string
  steps: number
  cfg: number
  /**
   * Per-family hires-fix resample overrides (booru families match the reference
   * Forge/A1111 metadata: denoise 0.35, hires CFG 5). Omitted for SDXL base,
   * which keeps the gentle denoise 0.2 and reuses the main-pass CFG.
   */
  hiresDenoise?: number
  hiresCfg?: number
  /**
   * Per-family recommended sampler + scheduler (ComfyUI names), applied to the
   * main pass and the hires-fix / detailer refines. SDXL base favours
   * dpmpp_2m_sde + karras; the booru models (Pony, Illustrious) favour the
   * community-standard "Euler a" (euler_ancestral) + normal.
   */
  sampler: string
  scheduler: string
  /** ESRGAN upscale model for the hires-fix pass. */
  upscaleModel: string
  /**
   * Apply clip skip 2 (CLIPSetLastLayer -2). True for booru-trained dual-CLIP
   * models (Pony, Illustrious); false for SDXL base 1.0 (correct at layer 1).
   */
  clipSkip: boolean
  /**
   * Apply a subtle photographic film-grain finishing pass. True for the
   * photorealistic base (SDXL); false for the anime/illustration families
   * (Pony, Illustrious) where grain reads as unwanted noise.
   */
  filmGrain: boolean
  /**
   * Offer ReActor face swap (uploaded photo or saved face model). True for the
   * photorealistic base (SDXL); the anime families (Pony, Illustrious) don't
   * expose it, matching the film-grain split.
   */
  faceSwap: boolean
}

// SDXL renders natively around 1024px; same ratio set the anime models use.
const SDXL_RATIOS = [
  { label: 'Portrait 2:3', width: 832, height: 1216 },
  { label: 'Story 9:16', width: 768, height: 1344 },
  { label: 'Square 1:1', width: 1024, height: 1024 },
  { label: 'Landscape 3:2', width: 1216, height: 832 },
  { label: 'Wide 16:9', width: 1344, height: 768 },
]

function makeSdxlWorkflow(config: SdxlConfig): WorkflowDefinition {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    supportsNegativePrompt: true,
    supportsLoRA: true,
    supportsPromptEnhancer: false,
    supportsInputImage: config.faceSwap,
    supportsUpscale: true,
    supportsDetailer: true,
    supportsImg2Img: true,
    supportsControlNet: true,
    controlNetKind: 'sdxl-union',
    supportsIpAdapter: true,
    ariaModelKind: 'checkpoint',
    aspectRatios: SDXL_RATIOS,
    defaultParams: {
      width: 832,
      height: 1216,
      seed: -1,
      negativePrompt: config.defaultNegative,
      steps: config.steps,
      cfg: config.cfg,
      upscale: true,
      // Only the anime families seed a default positive prompt; the photoreal
      // base leaves the box blank so a switch to it doesn't clobber the prompt.
      ...(config.defaultPositive ? { prompt: config.defaultPositive } : {}),
    },
    buildPrompt(params: GenerationParams): ComfyUIPrompt {
      const wf = JSON.parse(JSON.stringify(baseWorkflow)) as ComfyUIPrompt

      // Checkpoint: a chosen Aria checkpoint replaces the family's base model.
      wf['4'].inputs.ckpt_name = params.ariaModel ?? config.checkpoint

      // VAE: decode through a dedicated SDXL VAE (the fp16-fix) when one is
      // available instead of the checkpoint's baked VAE — this cures washed-out
      // colors on checkpoints whose own VAE overflows in fp16 (e.g. Illustrious).
      // Every VAE consumer below (decode, img2img, ControlNet, hires-fix,
      // detailer) reads vaeRef, so they all stay consistent. Absent → checkpoint
      // VAE (node 4 output 2), so a missing file never breaks the prompt.
      let vaeRef: [string, number] = ['4', 2]
      if (params.sdxlVae) {
        wf['vae:sdxl'] = { class_type: 'VAELoader', inputs: { vae_name: params.sdxlVae } }
        vaeRef = ['vae:sdxl', 0]
        wf['8'].inputs.vae = vaeRef
      }

      // Prompts (positive carries the family prefix, e.g. Pony score tags).
      wf['6'].inputs.text = config.positivePrefix + params.prompt
      wf['7'].inputs.text = params.negativePrompt ?? config.defaultNegative

      // Resolution + parallel batch (latent batch_size, capped at 4).
      wf['5'].inputs.width = params.width
      wf['5'].inputs.height = params.height
      wf['5'].inputs.batch_size = Math.max(1, Math.min(4, Math.round(params.batchSize ?? 1)))

      // Sampler. sampler_name/scheduler are the per-family recommended pair
      // (not user-exposed yet); steps/cfg fall back to the family default.
      wf['3'].inputs.seed = params.seed < 0 ? Math.floor(Math.random() * 9999999999999) : params.seed
      wf['3'].inputs.steps = params.steps ?? config.steps
      wf['3'].inputs.cfg = params.cfg ?? config.cfg
      wf['3'].inputs.sampler_name = config.sampler
      wf['3'].inputs.scheduler = config.scheduler

      // muscgi/muscgro LoRAs: insert a LoraLoader chain (nodes 100, 101, …) only
      // for set slots, then re-point the model + both CLIP encoders to the tail.
      const loras = [
        { name: params.lora1, strength: params.lora1Strength },
        { name: params.lora2, strength: params.lora2Strength },
      ].filter((l): l is { name: string; strength: number | undefined } => Boolean(l.name))

      let modelSrc: [string, number] = ['4', 0]
      let clipSrc: [string, number] = ['4', 1]
      let nextId = 100
      for (const lora of loras) {
        const id = String(nextId++)
        // No _meta: ComfyUIPromptNode only declares class_type + inputs, and an
        // object literal with extra keys would trip TS's excess-property check.
        wf[id] = {
          class_type: 'LoraLoader',
          inputs: {
            lora_name: lora.name,
            strength_model: lora.strength ?? 1,
            strength_clip: lora.strength ?? 1,
            model: modelSrc,
            clip: clipSrc,
          },
        }
        modelSrc = [id, 0]
        clipSrc = [id, 1]
      }
      wf['3'].inputs.model = modelSrc

      // Clip skip 2 for booru-trained models (Pony/Illustrious): insert a
      // CLIPSetLastLayer between the clip tail and every clip consumer.
      if (config.clipSkip) {
        wf['clip:skip'] = {
          class_type: 'CLIPSetLastLayer',
          inputs: { stop_at_clip_layer: -2, clip: clipSrc },
        }
        clipSrc = ['clip:skip', 0]
      }
      wf['6'].inputs.clip = clipSrc
      wf['7'].inputs.clip = clipSrc

      // Base-image modes (img2img/inpaint/outpaint): rewire the KSampler latent.
      // SDXL's VAE comes from the checkpoint loader (node 4, output 2). No-op for
      // txt2img. Returns the image ref downstream passes read — the outpaint
      // seam-removal composite in outpaint mode, else the plain decode (['8', 0]).
      const decoded = appendImg2Img(wf, params, { ksamplerId: '3', vae: vaeRef, decoded: ['8', 0] })

      // Reference guidance (SDXL family). IP-Adapter wraps the sampler model;
      // ControlNet rewires its positive/negative conditioning. Both read the
      // sampler's current inputs, so they compose with the LoRA tail + img2img.
      // Main pass only — hires-fix/detailer keep the base model + conditioning.
      appendIpAdapter(wf, params, { ksamplerId: '3' })
      appendControlNet(wf, params, { ksamplerId: '3', vae: vaeRef })

      // The legacy ESRGAN-only upscale nodes are always replaced by the
      // latent hires-fix below.
      delete wf['10']
      delete wf['11']
      delete wf['12']
      wf['9'].inputs.images = decoded

      // Latent hires-fix (optional, on by default): ESRGAN upscale → re-encode →
      // low-denoise resample for genuine added detail at net 1.5×.
      if (params.upscale !== false) {
        appendHiresFix(wf, {
          saveNodeId: '9',
          imageSource: decoded,
          model: modelSrc,
          positive: ['6', 0],
          negative: ['7', 0],
          vae: vaeRef,
          upscaleModel: config.upscaleModel,
          netScale: 1.5,
          modelScale: 4,
          sampler: {
            steps: 12,
            cfg: config.hiresCfg ?? params.cfg ?? config.cfg,
            sampler_name: config.sampler,
            scheduler: config.scheduler,
            denoise: config.hiresDenoise ?? 0.2,
            seed: params.seed < 0 ? Math.floor(Math.random() * 9999999999999) : params.seed,
          },
        })
      }

      // Face detailer (optional, on by default): detect-crop-redraw-paste over faces.
      if (params.detailer !== false) {
        appendFaceDetailer(wf, {
          saveNodeId: '9',
          model: modelSrc,
          clip: clipSrc,
          vae: vaeRef,
          positive: ['6', 0],
          negative: ['7', 0],
          sampler: {
            steps: params.steps ?? config.steps,
            cfg: params.cfg ?? config.cfg,
            sampler_name: config.sampler,
            scheduler: config.scheduler,
            denoise: 0.15,
          },
        })
      }

      // FaceFusion-grade swap (mask + color-match + tuned enhancer), applied
      // after the detailer — a latent resample / face redraw would otherwise
      // erode the swapped identity. The source face is either an uploaded photo
      // or a saved face model (built in the Tools tab). Photoreal base only.
      const faceFromModel = params.faceSwapSource === 'model'
      if (config.faceSwap && params.faceSwap && (faceFromModel ? params.faceModel : params.inputImage)) {
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

      // Subtle photographic grain (photorealistic base only): re-adds high-
      // frequency skin texture so output reads as a photo, not an airbrushed
      // render. Runs last so it grains the final upscale/detailer/swap output.
      if (config.filmGrain) {
        appendFilmGrain(wf, '9', { intensity: 0.04 })
      }

      return wf
    },
  }
}

export const sdxlWorkflow = makeSdxlWorkflow({
  id: 'sdxl',
  name: 'SDXL',
  description: 'Stable Diffusion XL base 1.0 — versatile photorealistic + illustration base model',
  checkpoint: 'sd_xl_base_1.0.safetensors',
  positivePrefix: '',
  defaultPositive: '',
  defaultNegative: 'worst quality, low quality, jpeg artifacts',
  steps: 30,
  cfg: 7,
  // SDXL base: DPM++ 2M SDE + Karras is the widely-recommended detail-rich pair.
  sampler: 'dpmpp_2m_sde',
  scheduler: 'karras',
  upscaleModel: '4x-UltraSharp.pth',
  clipSkip: false,
  filmGrain: true,
  faceSwap: true,
})

export const ponyWorkflow = makeSdxlWorkflow({
  id: 'pony',
  name: 'Pony',
  description: 'Pony Diffusion V6 XL — expressive characters; uses score_* quality tags',
  checkpoint: 'ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
  positivePrefix: '',
  defaultPositive: PONY_DEFAULT_POSITIVE,
  defaultNegative: PONY_DEFAULT_NEGATIVE,
  // Generation params mirror the reference Forge/A1111 metadata (prompt excluded):
  // Euler a + normal, hires 1.5× with denoise 0.35 / hires CFG 5. Steps follow
  // the official model card (Euler a ~25, converged by 28) instead of the
  // metadata's 35 — extra steps past ~28 cost ~25% time for no visible gain.
  // CFG 5 (softer than the metadata's 7) by user preference.
  // Upscaler stays the anime-tuned 4x-AnimeSharp rather than the metadata's UltraSharp.
  steps: 28,
  cfg: 5,
  // Pony V6: the community-standard pairing is Euler a (euler_ancestral) + normal.
  sampler: 'euler_ancestral',
  scheduler: 'normal',
  upscaleModel: '4x-AnimeSharp.pth',
  hiresDenoise: 0.35,
  hiresCfg: 5,
  clipSkip: true,
  filmGrain: false,
  faceSwap: false,
})

export const illustriousWorkflow = makeSdxlWorkflow({
  id: 'illustrious',
  name: 'Illustrious',
  description: 'Illustrious XL v0.1 — Danbooru-tag anime illustration base',
  checkpoint: 'Illustrious-XL-v0.1.safetensors',
  positivePrefix: '',
  defaultPositive: ANIME_DEFAULT_POSITIVE,
  defaultNegative: ANIME_DEFAULT_NEGATIVE,
  // Generation params mirror the reference Forge/A1111 metadata (prompt excluded):
  // Euler a + normal, hires 1.5× with denoise 0.35 / hires CFG 5. Steps follow
  // the official guidance (Euler a 20–28) instead of the metadata's 35 —
  // extra steps past ~28 cost ~25% time for no visible gain.
  // CFG 5 (low end of the official 5–7.5 band) by user preference.
  // Upscaler stays the anime-tuned 4x-AnimeSharp rather than the metadata's UltraSharp.
  steps: 28,
  cfg: 5,
  // Illustrious XL: Euler a (euler_ancestral) + normal.
  sampler: 'euler_ancestral',
  scheduler: 'normal',
  upscaleModel: '4x-AnimeSharp.pth',
  hiresDenoise: 0.35,
  hiresCfg: 5,
  clipSkip: true,
  filmGrain: false,
  faceSwap: false,
})
