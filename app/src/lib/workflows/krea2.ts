import type { WorkflowDefinition, GenerationParams, AspectRatio } from '@/types/workflow'
import type { ComfyUIPrompt } from '@/types/comfyui'
import baseWorkflow from '../../../workflows/image_krea2.json'
import { appendFaceDetailer } from './face-detailer'
import { selectedLoras, prependLoraChain, type SelectedLora } from './lora-chain'
import { appendFaceSwap } from './face-swap'
import { appendFilmGrain } from './film-grain'
import { appendHiresFix } from './hires-fix'
import { appendImg2Img } from './img2img'

/**
 * Krea2 — one template, two variants.
 *
 * Turbo is the 8-step distilled checkpoint; RAW is the 52-step base. They share
 * a text encoder, a VAE and a graph, and differ only in which UNET is loaded,
 * how many steps at what CFG, and whether a negative prompt means anything (it
 * does not at cfg 1 — there is no unconditional pass to steer away from).
 *
 * ComfyUI supports Krea2 in core at the pinned revision — `comfy/ldm/krea2/`,
 * `comfy/text_encoders/krea2.py`, and a `krea2_to_diffusers` LoRA key map in
 * `comfy/utils.py` that accepts both the ComfyUI and diffusers key layouts.
 * Nothing here needs a custom node.
 *
 * ⚠️ Krea2's sampling shift (1.15) is baked into ComfyUI's model config
 * (`comfy/supported_models.py` → `Krea2.sampling_settings`). Unlike Z-Image
 * there is deliberately no ModelSampling node in this graph; adding one
 * double-applies the shift.
 */

/** The TextFusion refusal-reduction LoRA, applied at a fixed strength of 1. */
export const KREA2_REFUSAL_LORA = 'Krea2_TextFusion_Refusal_Reduction.safetensors'

/**
 * The projector-scale LoRA. Upstream ships it as `pytorch_lora_weights.safetensors`
 * — meaningless in a shared `loras/` folder — so the Models page renames it on
 * download. This name and the one above are shared with the form and the Models
 * page; same single-source-of-truth role as `SDXL_FIX_VAE`.
 */
export const KREA2_PROJECTOR_LORA = 'krea2_projector_scale.safetensors'

/**
 * Projector strength the slider starts at. 0.01 = +1× prompt adherence, and 0
 * means the LoRA is never emitted at all.
 *
 * Off by default: it is surfaced as the "NSFW filter" knob, so it only earns its
 * place when a render actually came out censored — every other job pays nothing
 * for it, and the stock model stays the baseline people compare against.
 */
export const KREA2_PROJECTOR_DEFAULT = 0

/**
 * System prompt for the built-in enhancer, from ComfyUI's official Krea2
 * template with one deliberate change: the stock rule 8 ("Respect the Human
 * Form: … Assume clothing covers genitals and intimate anatomy") is dropped. It
 * makes the enhancer silently rewrite the user's own prompt against their stated
 * intent, which is the exact failure the refusal-reduction LoRA is here to fix.
 * Everything that makes the enhancer *useful* — faithfulness, T2I structure,
 * text rendering, medium preservation — is kept verbatim.
 */
const ENHANCER_SYSTEM_PROMPT = `You are an expert prompt engineer for text-to-image models. Your task is to expand the user's prompt into a highly effective image-generation prompt.

Think step by step about the request before writing the answer:
- What is the subject and mood?
- What visual styles, mediums, and lighting options would fit? Consider two or three alternatives and pick the one that best serves the caption.
- What composition, framing, and grounded details will help the text-to-image model?

Then output a single expanded prompt paragraph.

Follow these rules strictly:
1. **Faithfulness First:** Preserve all original subjects, actions, colors, and spatial relationships. Do not add new objects, props, characters, or animals unless the user clearly implies them.
2. **Practical T2I Structure:** Write a prompt that a text-to-image model can parse cleanly. Group subjects with their own attributes and actions. Use grounded phrasing for poses, interactions, and spatial layout.
3. **Style Planning Stays Internal:** Use your internal reasoning to choose style, medium, framing, and lighting. Do not emit planning tags or wrappers in the visible answer body.
4. **Text Rendering:** If the user requests visible text, quotes, labels, or typography, specify the exact text clearly and wrap requested words in quotes.
5. **Avoid Over-Specification:** Do not invent highly specific clothing, colors, materials, or scene details unless the input supports them.
6. **Structure:** Write one cohesive paragraph after the thinking block. No bullets, JSON, or markdown.
7. **Respect Existing Detail:** If the user's prompt is already detailed, lightly polish and finalize rather than heavily expanding — preserve their phrasing and direction.
8. **Preserve User Medium:** When the user explicitly requests a medium (e.g. "photo of", "photograph of", "illustration of", "painting of", "sketch of", "3D render of"), honor it. Do not pivot to a different medium to avoid difficulty — match the user's stated intent.

User's Input:

`

/** The ~1 MP ladder every image family in the app shares. */
const KREA2_RATIOS: AspectRatio[] = [
  { label: 'Portrait 2:3', width: 832, height: 1216 },
  { label: 'Story 9:16', width: 768, height: 1344 },
  { label: 'Square 1:1', width: 1024, height: 1024 },
  { label: 'Landscape 3:2', width: 1216, height: 832 },
  { label: 'Wide 16:9', width: 1344, height: 768 },
]

interface Krea2Variant {
  id: string
  name: string
  description: string
  /** Filename in `models/diffusion_models/`. */
  unet: string
  steps: number
  cfg: number
  /**
   * Whether a negative prompt does anything. Only true above cfg 1, where the
   * sampler actually runs an unconditional pass to steer away from.
   */
  negativePrompt: boolean
}

function krea2Workflow(v: Krea2Variant): WorkflowDefinition {
  return {
    id: v.id,
    name: v.name,
    description: v.description,
    supportsNegativePrompt: v.negativePrompt,
    supportsLoRA: true,
    loraFamily: 'krea2',
    supportsPromptEnhancer: true,
    supportsInputImage: true,
    supportsUpscale: true,
    supportsDetailer: true,
    supportsImg2Img: true,
    // No Krea2 ControlNet model has been published, and IP-Adapter is SDXL-only
    // in this codebase.
    supportsControlNet: false,
    supportsIpAdapter: false,
    ariaModelKind: 'unet',
    aspectRatios: KREA2_RATIOS,
    defaultParams: {
      width: 832,
      height: 1216,
      seed: -1,
      upscale: true,
      // Off by default: the enhancer rewrites what the user typed, so it is
      // opt-in, matching how Ernie's enhancer behaves.
      promptEnhancer: false,
      krea2ProjectorStrength: KREA2_PROJECTOR_DEFAULT,
    },
    buildPrompt(params: GenerationParams): ComfyUIPrompt {
      const wf = JSON.parse(JSON.stringify(baseWorkflow)) as ComfyUIPrompt
      const seed = params.seed < 0 ? Math.floor(Math.random() * 9999999999999) : params.seed

      // Variant: model + sampling budget.
      wf['k:unet'].inputs.unet_name = v.unet
      wf['k:sampler'].inputs.steps = v.steps
      wf['k:sampler'].inputs.cfg = v.cfg
      wf['k:sampler'].inputs.seed = seed

      // Aria/Patreon model: a full UNET diffusion-model fine-tune replaces the
      // base UNET; the CLIP and VAE loaders are untouched.
      if (params.ariaModel) wf['k:unet'].inputs.unet_name = params.ariaModel

      // Resolution + parallel batch (latent batch_size, capped at 4).
      wf['k:latent'].inputs.width = params.width
      wf['k:latent'].inputs.height = params.height
      wf['k:latent'].inputs.batch_size = Math.max(1, Math.min(4, Math.round(params.batchSize ?? 1)))

      // Negative conditioning. The template ships the turbo case (zeroed out);
      // RAW replaces the node in place with a real encode.
      if (v.negativePrompt) {
        wf['k:neg'] = {
          class_type: 'CLIPTextEncode',
          inputs: { text: params.negativePrompt ?? '', clip: ['k:loras', 1] },
        }
      }

      // Prompt enhancer: TextGenerate drives the already-loaded Qwen3-VL encoder
      // as an LLM, so it costs no extra download. Off → the node is deleted and
      // CLIPTextEncode takes the literal string. Expressing the toggle by node
      // presence rather than a baked PrimitiveBoolean also avoids ComfyUI's
      // bool("false") === True coercion trap (see ernie-turbo.ts).
      if (params.promptEnhancer === true) {
        wf['k:enhance'].inputs.prompt = ENHANCER_SYSTEM_PROMPT + params.prompt
      } else {
        delete wf['k:enhance']
        wf['k:pos'].inputs.text = params.prompt
      }

      // Built-in LoRAs. Both are model-only patches (no text-encoder tensors),
      // so prependLoraChain — called without a clip ref — emits
      // LoraLoaderModelOnly and hangs them upstream of the user stack. LoRA
      // patches are additive, so chain order carries no meaning.
      //
      // A filename only reaches here when the form saw it in ComfyUI's own
      // LoraLoader list, so "not downloaded" means the node is simply never
      // emitted, rather than a value_not_in_list validation failure.
      const builtins: SelectedLora[] = []
      if (params.krea2RefusalLora) {
        builtins.push({ name: params.krea2RefusalLora, strength: 1 })
      }
      const projectorStrength = params.krea2ProjectorStrength ?? KREA2_PROJECTOR_DEFAULT
      if (params.krea2ProjectorLora && projectorStrength > 0) {
        builtins.push({ name: params.krea2ProjectorLora, strength: projectorStrength })
      }
      const builtinSrc = prependLoraChain(wf, builtins, { model: ['k:unet', 0] }, 'krea2:builtin')

      // User LoRA stack — write all four rgthree slots explicitly (selected name
      // or the "None" sentinel) so a stale name baked into the template can't
      // leak through an empty slot. Selections are compacted, so a gap in the
      // form's rows leaves no gap here.
      const loras = selectedLoras(params)
      for (let i = 0; i < 4; i++) {
        const slot = `0${i + 1}`
        wf['k:loras'].inputs[`lora_${slot}`] = loras[i]?.name ?? 'None'
        wf['k:loras'].inputs[`strength_${slot}`] = loras[i]?.strength ?? 1
      }
      // The rgthree stack stops at four, so a fifth LoRA is chained upstream of
      // it — downstream of the built-ins, which it therefore composes with.
      const loraSrc = prependLoraChain(
        wf,
        loras.slice(4),
        { model: builtinSrc.model, clip: wf['k:loras'].inputs.clip as [string, number] },
        'lora:x',
      )
      wf['k:loras'].inputs.model = loraSrc.model
      wf['k:loras'].inputs.clip = loraSrc.clip

      // Base-image modes (img2img/inpaint/outpaint): rewire the sampler's latent
      // from the empty latent to a VAE-encoded source. No-op for txt2img.
      // Returns the image ref downstream passes read — the outpaint seam-removal
      // composite in outpaint mode, else the plain decode.
      const decoded = appendImg2Img(wf, params, {
        ksamplerId: 'k:sampler',
        vae: ['k:vae', 0],
        decoded: ['k:decode', 0],
      })
      wf['k:save'].inputs.images = decoded

      // Face swap runs LAST — after hires-fix and detailer — because a latent
      // resample or face redraw re-diffuses the face from the scene prompt and
      // erodes the swapped identity. Only its activeness is needed up front.
      const faceFromModel = params.faceSwapSource === 'model'
      const faceSwapActive = Boolean(
        params.faceSwap && (faceFromModel ? params.faceModel : params.inputImage),
      )

      // Latent hires-fix (on by default): ESRGAN upscale → re-encode →
      // low-denoise resample for genuine added detail at net 1.5×. Both variants
      // reuse their native steps/cfg: KSampler truncates the schedule by
      // denoise, so RAW's 52 steps at 0.2 is ~10 real steps, not 52.
      if (params.upscale !== false) {
        appendHiresFix(wf, {
          saveNodeId: 'k:save',
          imageSource: decoded,
          model: ['k:loras', 0],
          positive: ['k:pos', 0],
          negative: ['k:neg', 0],
          vae: ['k:vae', 0],
          upscaleModel: '4x-UltraSharp.pth',
          netScale: 1.5,
          modelScale: 4,
          sampler: {
            steps: v.steps,
            cfg: v.cfg,
            sampler_name: 'er_sde',
            scheduler: 'simple',
            denoise: 0.2,
            seed,
          },
        })
      }

      // Face detailer (on by default): detect-crop-redraw-paste over faces.
      if (params.detailer !== false) {
        appendFaceDetailer(wf, {
          saveNodeId: 'k:save',
          model: ['k:loras', 0],
          clip: ['k:loras', 1],
          vae: ['k:vae', 0],
          positive: ['k:pos', 0],
          negative: ['k:neg', 0],
          sampler: {
            steps: v.steps,
            cfg: v.cfg,
            sampler_name: 'er_sde',
            scheduler: 'simple',
            denoise: 0.25,
          },
        })
      }

      // FaceFusion-grade swap (mask + color-match + tuned enhancer), applied
      // last so the swapped identity survives the diffusion passes above.
      if (faceSwapActive) {
        appendFaceSwap(wf, {
          saveNodeId: 'k:save',
          ...(faceFromModel
            ? { faceModelName: params.faceModel! }
            : { faceFilename: params.inputImage! }),
          swapModel: params.faceSwapModel,
          pixelBoost: params.faceSwapPixelBoost,
          pixelBoostSize: params.faceSwapPixelBoostSize,
        })
      }

      // Subtle photographic grain: re-adds high-frequency texture so skin reads
      // as a photo rather than airbrushed. Runs dead last so it grains the final
      // upscale/detailer/swap output.
      appendFilmGrain(wf, 'k:save', { intensity: 0.04 })

      return wf
    },
  }
}

export const krea2TurboWorkflow = krea2Workflow({
  id: 'krea2-turbo',
  name: 'Krea2 Turbo',
  description: 'Fast 8-step Krea2 with optional 1.5× upscale and face swap',
  unet: 'krea2_turbo_fp8_scaled.safetensors',
  steps: 8,
  cfg: 1,
  negativePrompt: false,
})

export const krea2RawWorkflow = krea2Workflow({
  id: 'krea2-raw',
  name: 'Krea2 RAW',
  description: 'Full 52-step Krea2 base model — slower, highest fidelity',
  unet: 'krea2_raw_fp8_scaled.safetensors',
  steps: 52,
  cfg: 4,
  negativePrompt: true,
})
