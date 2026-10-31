import type { WorkflowDefinition, GenerationParams } from '@/types/workflow'
import type { ComfyUIPrompt } from '@/types/comfyui'
import type { LoraFamily } from '@/lib/models/lora-family'
import baseWorkflow from '../../../workflows/image_z_image_turbo.json'
import { appendFaceDetailer } from './face-detailer'
import { selectedLoras, prependLoraChain } from './lora-chain'
import { appendFaceSwap } from './face-swap'
import { appendFilmGrain } from './film-grain'
import { appendHiresFix } from './hires-fix'
import { appendImg2Img } from './img2img'
import { appendZImageControlNet } from './zimage-controlnet'

/**
 * The distilled model's native sampler budget — what the template JSON's KSampler
 * already carries, named here so the hires-fix / detailer passes below and the
 * Expert Mode panel's starting values all read the same numbers instead of three
 * copies drifting apart. Only Expert Mode can change what actually runs
 * (see expert-sampler.ts).
 */
const NATIVE = { steps: 8, cfg: 1, sampler: 'res_multistep', scheduler: 'simple' } as const

export const zImageTurboWorkflow: WorkflowDefinition = {
  id: 'z-image-turbo',
  name: 'Z Image Turbo',
  description: 'Fast turbo-style generation with optional 1.5× upscale and face swap',
  // Read off the template rather than repeated: this is the exact name the graph
  // asks ComfyUI for, so the "installed?" check can never drift from the loader.
  baseModel: baseWorkflow['57:28'].inputs.unet_name,
  supportsNegativePrompt: false,
  supportsLoRA: true,
  loraFamily: 'zimage',
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
    ...NATIVE,
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

    // LoRA stack — always write all four slots explicitly (selected name or the
    // "None" sentinel the rgthree stack expects). Writing unconditionally, rather
    // than only when a LoRA is picked, prevents a stale name baked into the
    // template JSON from leaking through an empty slot into the submitted prompt.
    // Selections are compacted, so a gap in the form's slots leaves no gap here.
    const loras = selectedLoras(params)
    for (let i = 0; i < 4; i++) {
      const slot = `0${i + 1}`
      wf['57:62'].inputs[`lora_${slot}`] = loras[i]?.name ?? 'None'
      wf['57:62'].inputs[`strength_${slot}`] = String(loras[i]?.strength ?? 1)
    }
    // The rgthree stack stops at four, so a fifth LoRA is chained upstream of it.
    const loraSrc = prependLoraChain(
      wf,
      loras.slice(4),
      { model: wf['57:62'].inputs.model as [string, number], clip: wf['57:62'].inputs.clip as [string, number] },
      'lora:x',
    )
    wf['57:62'].inputs.model = loraSrc.model
    wf['57:62'].inputs.clip = loraSrc.clip

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

    // Face swap runs after hires-fix — a full-strength latent resample re-diffuses
    // the face from the scene prompt and erodes the swapped identity. The detailer
    // follows the swap at POST_SWAP_DENOISE, low enough to re-seat the face in the
    // scene without redrawing it. We only need to know up front whether it is
    // active; the nodes are appended after the diffusion passes below.
    const faceFromModel = params.faceSwapSource === 'model'
    const faceSwapActive = Boolean(
      params.faceSwap && (faceFromModel ? params.faceModel : params.inputImage),
    )

    // Hires-fix operates on the plain generated (pre-swap) image (`decoded`).

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
          steps: NATIVE.steps,
          cfg: NATIVE.cfg,
          sampler_name: NATIVE.sampler,
          scheduler: NATIVE.scheduler,
          denoise: 0.2,
          seed: params.seed < 0 ? Math.floor(Math.random() * 9999999999999) : params.seed,
        },
      })
    }

    // Face detailer (optional, on by default): detect-crop-redraw-paste over faces.
    // Kept ON alongside the face swap, and that is load-bearing rather than
    // cosmetic. Measured 2026-09-05 on ComfyUI v0.34.2: with the detailer in
    // the graph, repeated face-swap renders are clean (12/12 across 3 fresh
    // ComfyUI sessions); WITHOUT it, only the first render of a session works
    // and every one after comes back a pure black frame (3/12). Removing this
    // pass to save its ~3 s puts users straight into that failure.
    //
    // It also has to run BEFORE the swap. A redraw over an already-swapped
    // face destroys the identity: ArcFace cosine vs the source photo is 0.853
    // detailer-then-swap, 0.851 swap-only, and 0.534 swap-then-detailer even
    // at 0.15 denoise. See swap-detailer-order.test.ts.
    // Forced ON whenever a swap is active, overriding an explicit `detailer:
    // false`. This is a workaround for a live bug, not a preference: without the
    // detailer in the graph, only the FIRST face-swap render of a ComfyUI session
    // succeeds and every one after comes back a pure black frame (measured
    // 2026-09-05 on ComfyUI v0.34.2 -- 12/12 renders clean with it, 3/12 without).
    // The user's toggle is honoured for every render that has no swap.
    if (params.detailer !== false || faceSwapActive) {
      appendFaceDetailer(wf, {
        saveNodeId: '9',
        model: ['57:11', 0],
        clip: ['57:62', 1],
        vae: ['57:29', 0],
        positive: ['57:27', 0],
        negative: ['57:33', 0],
        sampler: { steps: NATIVE.steps, cfg: NATIVE.cfg, sampler_name: NATIVE.sampler, scheduler: NATIVE.scheduler, denoise: 0.25 },
      })
    }

    // FaceFusion-grade swap (mask + color-match + tuned enhancer), applied
    // LAST — after the detailer — because a face redraw over a swapped
    // face destroys the identity. Measured 2026-09-05, 3 seeds, ArcFace
    // cosine vs the source photo: detailer-then-swap 0.853, swap only
    // 0.851, swap-then-detailer at just 0.15 denoise **0.534**. The
    // detailer runs on ALL faces while the swap only replaces one, so
    // this order is also what keeps the other faces detailed.
    if (faceSwapActive) {
      appendFaceSwap(wf, {
        saveNodeId: '9',
        ...(faceFromModel
          ? { faceModelName: params.faceModel! }
          : { faceFilename: params.inputImage! }),
        swapModel: params.faceSwapModel,
        pixelBoost: params.faceSwapPixelBoost,
        pixelBoostSize: params.faceSwapPixelBoostSize,
        identity: params.faceSwapIdentity,
      })
    }

    // Subtle photographic grain (photorealistic model): re-adds high-frequency
    // texture so skin reads as a photo rather than airbrushed. Runs dead last so
    // it grains the final upscale/detailer/swap output.
    appendFilmGrain(wf, '9', { intensity: 0.04 })

    return wf
  },
}

/**
 * Z-Image Turbo renders a **pure black image** once the prompt gets long enough,
 * with no error at all — ComfyUI reports `status_str: success` and writes a
 * black PNG. Measured live 2026-08-23 on ComfyUI 0.30.0, holding seed and
 * resolution fixed and growing only the prompt: 430 characters renders, 440 is
 * black. It is a text-encoder cliff, so the true unit is tokens and the exact
 * cutoff moves with wording — hence a margin below the measured edge.
 *
 * Only Z-Image is affected; Krea2, Anima, SDXL and Ernie all render long
 * prompts fine.
 */
export const ZIMAGE_PROMPT_LIMIT = 400

/** The characters a family's prompt must stay under, or undefined when it has no cliff. */
export function promptLimit(family: LoraFamily | undefined): number | undefined {
  return family === 'zimage' ? ZIMAGE_PROMPT_LIMIT : undefined
}

/**
 * A warning for the prompt as sent (after wildcard expansion it can only grow).
 * Returns null when there is nothing to say.
 */
export function promptLengthWarning(
  family: LoraFamily | undefined,
  effectivePrompt: string,
): string | null {
  const limit = promptLimit(family)
  const n = effectivePrompt.length
  if (!limit || n <= limit) return null
  return `Z-Image renders a black image past roughly ${limit} characters — this prompt is ${n}. Shorten it, or switch model.`
}
