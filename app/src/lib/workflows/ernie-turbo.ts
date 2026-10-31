import type { WorkflowDefinition, GenerationParams } from '@/types/workflow'
import type { ComfyUIPrompt } from '@/types/comfyui'
import baseWorkflow from '../../../workflows/image_ernie_image_turbo.json'
import { appendFaceDetailer } from './face-detailer'
import { selectedLoras, prependLoraChain } from './lora-chain'
import { appendFaceSwap } from './face-swap'
import { appendFilmGrain } from './film-grain'
import { appendHiresFix } from './hires-fix'
import { appendImg2Img } from './img2img'

/**
 * The distilled model's native sampler budget — what the template JSON's KSampler
 * already carries, named here so the hires-fix / detailer passes below and the
 * Expert Mode panel's starting values all read the same numbers instead of three
 * copies drifting apart. Only Expert Mode can change what actually runs
 * (see expert-sampler.ts).
 */
const NATIVE = { steps: 8, cfg: 1, sampler: 'euler', scheduler: 'simple' } as const

/** The template's prompt-enhancer chain: its file loader, TextGenerate, the size/prompt fill-ins, the switch and previews. */
const ERNIE_ENHANCER_NODES = ['88:93', '88:95', '88:96', '88:97', '88:98', '88:99', '88:100', '88:101', '88:102', '88:103']
/** The enhancer's model file — optional on the Models page. */
export const ERNIE_ENHANCER = 'ernie-image-prompt-enhancer.safetensors'

export const ernieTurboWorkflow: WorkflowDefinition = {
  id: 'ernie-turbo',
  name: 'Ernie Image Turbo',
  description: 'Fast photorealistic generation with optional 1.5× upscale and face swap',
  // Read off the template — see z-image-turbo.ts for why.
  baseModel: baseWorkflow['88:66'].inputs.unet_name,
  supportsNegativePrompt: false,
  supportsLoRA: true,
  loraFamily: 'ernie',
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
    ...NATIVE,
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
    if (params.promptEnhancer === true) {
      // The enhancer writes for the canvas it is told about; the template says 832×1216.
      wf['88:99'].inputs.source = params.width
      wf['88:100'].inputs.source = params.height
    } else {
      // Off means off: ComfyUI validates every node an output is wired to, lazy
      // switch branch included, so the chain would demand the enhancer file —
      // which the Models page counts optional (a row reads Ready without it).
      wf['88:67'].inputs.text = ['88:94', 0]
      for (const id of ERNIE_ENHANCER_NODES) delete wf[id]
    }

    // LoRA stack (slots 01-04) — always write every slot explicitly (selected
    // name or the "None" sentinel) so a stale name baked into the template JSON
    // can't leak through an empty slot into the submitted prompt. Selections are
    // compacted, so a gap in the form's slots leaves no gap here.
    const loras = selectedLoras(params)
    for (let i = 0; i < 4; i++) {
      const slot = `0${i + 1}`
      wf['88:104'].inputs[`lora_${slot}`] = loras[i]?.name ?? 'None'
      wf['88:104'].inputs[`strength_${slot}`] = String(loras[i]?.strength ?? 0.9)
    }
    // The rgthree stack stops at four, so a fifth LoRA is chained upstream of it.
    const loraSrc = prependLoraChain(
      wf,
      loras.slice(4),
      { model: wf['88:104'].inputs.model as [string, number], clip: wf['88:104'].inputs.clip as [string, number] },
      'lora:x',
    )
    wf['88:104'].inputs.model = loraSrc.model
    wf['88:104'].inputs.clip = loraSrc.clip

    // Aria/Patreon model: a full UNET diffusion-model fine-tune replaces the
    // base UNET (UNETLoader); base CLIP/VAE loaders are untouched.
    if (params.ariaModel) {
      wf['88:66'].inputs.unet_name = params.ariaModel
    }

    // Base-image modes (img2img/inpaint/outpaint). No-op for txt2img. Returns
    // the image ref downstream passes read — the outpaint seam-removal composite
    // in outpaint mode, else the plain decode (['88:65', 0]).
    const decoded = appendImg2Img(wf, params, { ksamplerId: '88:70', vae: ['88:63', 0], decoded: ['88:65', 0] })

    // Face swap runs after hires-fix — a full-strength latent resample would erode
    // the swapped identity. The detailer follows the swap at POST_SWAP_DENOISE,
    // low enough to re-seat the face without redrawing it. We only need to know
    // up front whether it is active.
    const faceFromModel = params.faceSwapSource === 'model'
    const faceSwapActive = Boolean(
      params.faceSwap && (faceFromModel ? params.faceModel : params.inputImage),
    )

    // Hires-fix operates on the plain decoded image (`decoded`, above).

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
        saveNodeId: '73',
        model: ['88:104', 0],
        clip: ['88:104', 1],
        vae: ['88:63', 0],
        positive: ['88:67', 0],
        negative: ['88:91', 0],
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
        saveNodeId: '73',
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
    // texture so skin reads as a photo rather than airbrushed. Runs last so it
    // grains the final detailer/upscale/swap output.
    appendFilmGrain(wf, '73', { intensity: 0.04 })

    return wf
  },
}
