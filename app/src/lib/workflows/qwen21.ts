import type { WorkflowDefinition, GenerationParams, AspectRatio } from '@/types/workflow'
import type { ComfyUIPrompt } from '@/types/comfyui'
import baseWorkflow from '../../../workflows/image_qwen21.json'
import { selectedLoras, prependLoraChain } from './lora-chain'
import { appendFaceDetailer } from './face-detailer'
import { appendFaceSwap } from './face-swap'
import { appendFilmGrain } from './film-grain'
import { appendHiresFix } from './hires-fix'
import { appendImg2Img } from './img2img'
import { appendZImageControlNet, QWEN21_FUN_MODEL } from './zimage-controlnet'

/**
 * Qwen-Image 2.1 — one template, two presets, set up like Krea2: Turbo is the
 * everyday few-step model, the base runs the full schedule.
 *
 * Core ComfyUI (v0.38.0) does all of it: `comfy/ldm/qwen_image21/`, the
 * Qwen3-VL-8B text encoder behind `CLIPLoader type: qwen_image`, and
 * `TextEncodeQwenImage21`, which returns the positive AND the negative
 * conditioning — and takes reference images, which is Qwen's edit mode.
 *
 * ⚠️ The sampling shift (0.69 — diffusers' dynamic μ evaluated at 1024²) is
 * baked into `supported_models.py → QwenImage21`. No ModelSampling node here,
 * exactly like Krea2: one would double-apply it.
 *
 * Both presets run at cfg 1, which ComfyUI's own template calls "the official
 * path". A negative prompt does nothing there, so neither preset shows the box;
 * Expert Mode raising CFG brings it back (expert-sampler.ts).
 */

/*
 * ⚠️ A Qwen 2.1 render can come back as GREY TEXTURE (rainbow noise under
 * ControlNet) while ComfyUI reports success: the sampler hands back its starting
 * noise barely touched. A saved latent of one is unit noise per channel, and it
 * decodes to the same texture in a fresh ComfyUI, so the VAE is not it. Cause not
 * found; measured on 0.38.0, 2026-10-01:
 * - Reproducible, 7/7 fresh processes: three Turbo renders at 1024² WITHOUT the
 *   face detailer, then one at 832×1216 WITH it — that one is texture. Same with
 *   DynamicVRAM on or off, the Triton backend off, sage off, async offload off,
 *   cudaMallocAsync off. The other orders render clean (the detailer render first,
 *   or a plain 832×1216 render before it, or the detailer on throughout), the
 *   detection models alone don't do it, and Z-Image renders the recipe clean
 *   (one run each).
 * - With DynamicVRAM off it then sticks: later renders of BOTH Qwen models, any
 *   size, come back texture at random until ComfyUI restarts (`/free` does not
 *   help). With the default DynamicVRAM the one such run recovered on the next
 *   render. HiRes + detailer, ControlNet and enhancer jobs tipped processes over
 *   earlier that day too.
 * - A previous version of this note blamed DynamicVRAM (one sequence was 8/8
 *   clean with it off); the recipe above refutes that.
 *
 * What the builder does: route the model through `QwenImage21Cache` with
 * `device: off` (node `q:cache`) — sequences that went grey 4/4 with the prefix
 * K/V cache on were 22/22 clean with it off. A reduction, not a fix. Cost: none
 * measurable for text-to-image.
 */

/** int8_convrot, like the H3 DiTs: half the bf16 download, fits a 16 GB card,
 *  and not the fp8_scaled format DynamicVRAM corrupts on Krea2. */
export const QWEN21_BASE_UNET = 'qwen_image_2.1_int8_convrot.safetensors'

/**
 * The Turbo preset's model: Viggle's distillation merged into the weights.
 * Chosen by the live comparison in `qwen21-turbo-pick.live.test.ts`
 * (spec: "Picking the Turbo").
 */
export const QWEN21_TURBO_UNET = 'Qwen-Image-2.1-viggle-turbo-v0.3-6step-int8_convrot.safetensors'

/**
 * Shown on every Qwen preset and Models card: the family shipped (owner,
 * 2026-10-02) with the grey-texture bug still open — a render can come back as
 * undenoised noise, cause unknown (see the note above QWEN21_BASE_UNET).
 */
export const QWEN21_EXPERIMENTAL = 'Experimental: a render can come back as grey noise — render again, or restart ComfyUI if it repeats.'

/** The pictures an edit takes: the one being edited plus three references. */
export const QWEN21_EDIT_SLOTS = 4

/**
 * How many pictures an edit sends: a chip takes only the pictures its
 * instruction names (BFS: <image1> + <image2>; the sheet: the person in
 * picture 1). The builder cuts the list to it; the panel dims the slots past it.
 */
export function editPictureLimit(chip: GenerationParams['editChip']): number {
  return chip === 'bfs' ? 2 : chip === 'sheet' ? 1 : QWEN21_EDIT_SLOTS
}

/**
 * BFS head-swap LoRAs (MIT, huggingface.co/Alissonerdx/BFS-Best-Face-Swap):
 * picture 1 is the image being edited, picture 2 the head brought in. The
 * alternative build is the default — it won qwen21-bfs-ab.live.test.ts
 * (ArcFace 0.678 vs 0.590 over 9 pairs, and held the body where v1.1 once
 * slimmed it), though its author recommends v1.1.
 */
export const QWEN21_BFS_LORAS: Record<NonNullable<GenerationParams['bfsVariant']>, string> = {
  alternative: 'bfs_head_v1.1_alternative_qwen_2.1.safetensors',
  'v1.1': 'bfs_head_v1.1_qwen_2.1.safetensors',
}

/** Where a BFS build downloads from — Advanced's extras row and Simple's Qwen Edit both fetch it here. */
export const qwen21BfsUrl = (variant: NonNullable<GenerationParams['bfsVariant']>) =>
  `https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/resolve/main/${QWEN21_BFS_LORAS[variant]}`

/** BFS's own prompt, verbatim: it names <image1>/<image2> and was trained on it. */
export const QWEN21_BFS_PROMPT = 'head_swap: start with <image1> as the base image, keeping its lighting, environment, and background. remove the head from <image1> completely and replace it with the head from <image2>, strictly preserving the hair, eye color, nose structure from <image2>. copy the direction of the eye, head rotation, micro expressions from <image1>, high quality, sharp details, 4k'

/**
 * The character-sheet instruction, measured (spec M2,
 * qwen21-sheet-pick.live.test.ts, 2026-10-02, 3 people × 2 seeds on the Edit
 * preset): three views on picture 1's own canvas — the encode node's latent,
 * like every edit — scored ArcFace 0.812 against the source face, best for
 * every person; four views 0.742, a 1344×768 canvas 0.690 / 0.651. A portrait
 * picture 1 gives each view 1248 px of height against the wide canvas's 768.
 */
export const QWEN21_SHEET_PROMPT = 'character reference sheet of the person in picture 1: three full-body views side by side, front, side and back, the same face, hair and outfit in every view, neutral standing pose, identical scale and lighting, plain light grey background, sharp details'

/**
 * Viggle v0.3's raw student nodes, from their `viggle_turbo.py`
 * (`ViggleTurboSigmas`). The distillation was trained on these timesteps; a
 * KSampler scheduler spreading 6 steps its own way samples it off them.
 */
const VIGGLE_NODES = [1, 0.9375, 0.875, 0.75, 0.5, 0.25]

/**
 * Viggle's schedule for a canvas: diffusers' dynamic exponential shift with μ
 * from the token count (one token per 16×16 pixels), then a final 0. It moves
 * with resolution, which ComfyUI's fixed per-model shift cannot express — hence
 * ManualSigmas rather than a scheduler.
 */
export function viggleSigmas(width: number, height: number): number[] {
  const tokens = Math.round(width / 16) * Math.round(height / 16)
  const mu = 0.5 + ((0.9 - 0.5) * (tokens - 256)) / (8192 - 256)
  const e = Math.exp(mu)
  return [...VIGGLE_NODES.map((t) => e / (e + (1 / t - 1))), 0]
}

/**
 * Qwen's own prompt enhancer: a Qwen3.5-9B finetune for text-to-image, 9.5 GB,
 * a download of its own. The system prompt is ComfyUI's stock one (lifted into
 * image_qwen21.json), which has no content-rewriting rule to remove — unlike
 * Krea2's rule 8.
 *
 * ComfyUI's stock template wires that prompt into TextGenerate with
 * `use_default_template: false`, which makes TextGenerate ignore it entirely;
 * ours sets it true so the system prompt actually reaches the model.
 *
 * `thinking: true` is measured, not copied (qwen21-enhancer.live.test.ts, 5
 * prompts × 6 seeds, 2026-10-01): with thinking off the model wrote its own
 * reasoning — "Step 1 — …", "The user's brief is in English and fixes…" — into
 * the prompt in 8/30 outputs; with it on, 0/30, none truncated (thinking
 * lands in TextGenerate's second output). It costs ~28 s per enhancement
 * instead of ~16. `max_length` 2560 is twice the longest answer (~1170
 * tokens), headroom for the reasoning that shares the budget. The same lesson
 * Krea2 learned in the other direction: read output 0, never the picture.
 */
export const QWEN21_PE_T2I = 'qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors'

/** The ratios the enhancer's system prompt knows (its Step 2). */
const PE_RATIOS: [string, number][] = [
  ['1:1', 1], ['2:3', 2 / 3], ['3:2', 3 / 2], ['3:4', 3 / 4], ['4:3', 4 / 3],
  ['9:16', 9 / 16], ['16:9', 16 / 9], ['1:2', 1 / 2], ['2:1', 2],
]

/**
 * The canvas as one of those ratios. Step 2 of the stock prompt picks a ratio
 * from the subject "unless the user states one", and the description's opening
 * sentence names the orientation — so an unstated ratio lets it write "vertical"
 * for a 16:9 canvas.
 */
function peRatio(width: number, height: number): string {
  const r = Math.log(width / height)
  return PE_RATIOS.reduce((best, cur) =>
    Math.abs(Math.log(cur[1]) - r) < Math.abs(Math.log(best[1]) - r) ? cur : best,
  )[0]
}

/** Pruna 8-step v0.1, from its model card: shift 2 on evenly spaced t, fixed. */
export const PRUNA_8STEP_SIGMAS = [1, 14 / 15, 6 / 7, 10 / 13, 2 / 3, 6 / 11, 0.4, 2 / 9, 0]

/** ManualSigmas parses with a plain decimal regex — no exponent notation. */
export function formatSigmas(sigmas: number[]): string {
  return sigmas.map((s) => s.toFixed(6)).join(', ')
}

/**
 * The refinement passes (HiRes fix, detailer) run euler / simple — deterministic.
 * Krea2 learned the hard way that a stochastic sampler at denoise 0.15 invents
 * texture instead of refining it (krea2.ts, KREA2_REFINE_SAMPLER).
 */
const QWEN21_REFINE = { sampler_name: 'euler', scheduler: 'simple' } as const

/** The ~1 MP ladder every image family shares. Every side is a multiple of 32,
 *  as Qwen wants, and stays one at the HiRes fix's 1.5×. */
const QWEN21_RATIOS: AspectRatio[] = [
  { label: 'Portrait 2:3', width: 832, height: 1216 },
  { label: 'Story 9:16', width: 768, height: 1344 },
  { label: 'Square 1:1', width: 1024, height: 1024 },
  { label: 'Landscape 3:2', width: 1216, height: 832 },
  { label: 'Wide 16:9', width: 1344, height: 768 },
]

interface Qwen21Variant {
  id: string
  name: string
  description: string
  /** Filename in `models/diffusion_models/`. */
  unet: string
  steps: number
  /**
   * Steps for the low-denoise refinement passes (HiRes fix, detailer). Absent ⇒
   * `steps`. The base's 40 made HiRes + detailer 4× its text-to-image time
   * (27.0 s vs 6.7 s, 2026-10-01): at denoise 0.15 every one of them runs over
   * the same tail of the schedule, so 12 refine the same range more coarsely.
   */
  refineSteps?: number
  /** The distilled schedule for a canvas. Absent ⇒ KSampler's own (euler / simple). */
  sigmas?: (width: number, height: number) => number[]
  /** The Edit preset: reads `qwenReferences` and the chips, no base image, no ControlNet. */
  edit?: boolean
}

/**
 * Swap the template KSampler for SamplerCustom on an explicit sigma list,
 * under the same node id so VAEDecode and every helper keep reading it.
 * Called last on the main pass, so it copies whatever model / latent the
 * earlier passes (LoRAs, ControlNet, references, a base image) already wired in.
 *
 * A base-image mode left a denoise below 1 on the KSampler: core
 * SplitSigmasDenoise keeps the schedule's last round(6 × denoise) steps, so the
 * student still samples its own timesteps. The KSampler it replaces spread 6
 * steps over a stock tail and over-cooked every Turbo base-image render
 * (qwen21-basemodes.live.test.ts, 2026-10-02: img2img p99 detail 178 vs 119
 * here, inpaint crusted the skin and ignored the edit).
 * ponytail: the Strength slider moves in sixths here, and a cut starts at a
 * higher sigma than a KSampler denoise of the same number — the inpaint edit
 * landed where the base's own KSampler did not. Re-tune if Strength feels off.
 */
function applyDistilledSchedule(wf: ComfyUIPrompt, sigmas: number[], seed: number, sampler = 'euler', cfg = 1): void {
  const k = wf['q:sampler'].inputs
  wf['q:sigmas'] = { class_type: 'ManualSigmas', inputs: { sigmas: formatSigmas(sigmas) } }
  let schedule: [string, number] = ['q:sigmas', 0]
  if (Number(k.denoise) < 1) {
    wf['q:split'] = { class_type: 'SplitSigmasDenoise', inputs: { sigmas: schedule, denoise: k.denoise } }
    schedule = ['q:split', 1]
  }
  wf['q:select'] = { class_type: 'KSamplerSelect', inputs: { sampler_name: sampler } }
  wf['q:sampler'] = {
    class_type: 'SamplerCustom',
    inputs: {
      model: k.model,
      add_noise: true,
      noise_seed: seed,
      cfg,
      positive: k.positive,
      negative: k.negative,
      sampler: ['q:select', 0],
      sigmas: schedule,
      latent_image: k.latent_image,
    },
    _meta: { title: 'SamplerCustom (distilled schedule)' },
  }
}

/**
 * Qwen-Image 2.1's VAE decodes RGBA — four channels, for the model's native
 * transparency (`comfy/sd.py`: "Qwen Image 2.1 VAE … RGBA"; the saved PNGs are
 * pix_fmt rgba). Everything after a decode is RGB-only: Film Grain blends via
 * PIL and fails with "images do not match", FaceDetailer's SAM rejects the
 * tensor ("set_torch_image input must be BCHW with long side 1024"), and the
 * ESRGAN upscale and the swap expect three channels. So every decode is
 * followed by core SplitImageWithAlpha and every consumer reads its RGB output.
 * Found by the live suite, 2026-10-01. (FaceDetailer's own internal decode is
 * fine: Impact pastes an RGBA crop into an RGB image using its alpha as mask.)
 *
 * Runs last, so it catches the HiRes pass's decode and whatever the img2img /
 * outpaint helpers wired to the main decode.
 *
 * ponytail: drops the alpha outright, so a "transparent sticker" prompt loses
 * its transparency. Keep alpha behind a toggle if that is ever wanted.
 */
function dropDecodeAlpha(wf: ComfyUIPrompt): void {
  for (const [id, node] of Object.entries(wf)) {
    if (node.class_type !== 'VAEDecode') continue
    const rgbId = `${id}:rgb`
    for (const other of Object.values(wf)) {
      for (const [key, value] of Object.entries(other.inputs)) {
        if (Array.isArray(value) && value[0] === id && value[1] === 0) other.inputs[key] = [rgbId, 0]
      }
    }
    wf[rgbId] = { class_type: 'SplitImageWithAlpha', inputs: { image: [id, 0] } }
  }
}

function qwen21Preset(v: Qwen21Variant): WorkflowDefinition {
  return {
    id: v.id,
    name: v.name,
    description: v.description,
    baseModel: v.unet,
    supportsNegativePrompt: false,
    supportsLoRA: true,
    loraFamily: 'qwen21',
    supportsPromptEnhancer: !v.edit,
    supportsInputImage: true,
    supportsUpscale: true,
    supportsDetailer: true,
    supportsImg2Img: !v.edit,
    supportsControlNet: !v.edit,
    controlNetKind: v.edit ? undefined : 'qwen21-fun',
    // SDXL-only in this codebase; Qwen's reference images replace it (edit mode).
    supportsIpAdapter: false,
    ariaModelKind: 'unet',
    distilledSchedule: v.sigmas ? true : undefined,
    referenceSlots: v.edit ? QWEN21_EDIT_SLOTS : undefined,
    aspectRatios: QWEN21_RATIOS,
    defaultParams: {
      width: 832,
      height: 1216,
      seed: -1,
      upscale: true,
      // Off by default: the enhancer rewrites what the user typed, so it is
      // opt-in, as on Krea2 and Ernie.
      promptEnhancer: false,
      // What Expert Mode opens with: this preset's own budget.
      steps: v.steps,
      cfg: 1,
      sampler: 'euler',
      scheduler: 'simple',
    },
    buildPrompt(params: GenerationParams): ComfyUIPrompt {
      const wf = JSON.parse(JSON.stringify(baseWorkflow)) as ComfyUIPrompt
      const seed = params.seed < 0 ? Math.floor(Math.random() * 9999999999999) : params.seed

      // An Aria model is a full diffusion-model fine-tune: it replaces the base.
      wf['q:unet'].inputs.unet_name = params.ariaModel || v.unet
      wf['q:sampler'].inputs.steps = v.steps
      wf['q:sampler'].inputs.seed = seed

      wf['q:latent'].inputs.width = params.width
      wf['q:latent'].inputs.height = params.height
      wf['q:latent'].inputs.batch_size = Math.max(1, Math.min(4, Math.round(params.batchSize ?? 1)))

      // Pictures = Qwen's edit mode (wired below, after the enhancer), the Edit
      // preset only: pictures an edit left in the form must never reach a
      // text-to-image render. A chip takes only the pictures it names.
      const chip = v.edit ? params.editChip : undefined
      const refs = v.edit ? (params.qwenReferences ?? []).slice(0, editPictureLimit(chip)) : []

      // Prompt enhancer, by node presence (the Krea2 pattern — no switch node,
      // no bool("false") trap). Needs the toggle AND the confirmed file, and no
      // references: this is the text-to-image enhancer, it never sees them.
      if (params.promptEnhancer === true && params.qwen21Enhancer && refs.length === 0) {
        wf['q:pe'].inputs.clip_name = params.qwen21Enhancer
        wf['q:enhance'].inputs.prompt = `${params.prompt}\n\nAspect ratio: ${peRatio(params.width, params.height)}`
        // Follows the render seed: a fixed enhancer seed made one bad draw fail
        // every time for a given prompt on Krea2.
        wf['q:enhance'].inputs['sampling_mode.seed'] = seed
        wf['q:enc'].inputs.prompt = ['q:enhance', 0]
      } else {
        delete wf['q:pe']
        delete wf['q:enhance']
        wf['q:enc'].inputs.prompt = params.prompt
      }

      // The encode node VAE-encodes each reference into `reference_latents` and
      // returns a latent sized to the first (its `resolution: 1024` keeps ~1 MP
      // of AREA, not the sides) — the canvas the edit must be sampled on, or it
      // shifts (the node's own tooltip). The sheet samples on it too (M2).
      refs.forEach((image, i) => {
        wf[`q:ref:${i}`] = { class_type: 'LoadImage', inputs: { image, upload: 'image' } }
        wf['q:enc'].inputs[`images.image_${i + 1}`] = [`q:ref:${i}`, 0]
      })
      if (refs.length > 0) {
        wf['q:enc'].inputs.vae = ['q:vae', 0]
        wf['q:sampler'].inputs.latent_image = ['q:enc', 2]
      }
      // Inert at cfg 1, real once Expert Mode raises CFG.
      wf['q:enc'].inputs.negative_prompt = params.negativePrompt ?? ''

      // The head-swap chip's LoRA is part of the edit, not a user pick:
      // model-only, upstream of the user stack, so it composes with theirs. The
      // form only queues the chip once ComfyUI lists the file.
      const bfs = chip === 'bfs' ? [{ name: QWEN21_BFS_LORAS[params.bfsVariant ?? 'alternative'], strength: 1 }] : []
      const editSrc = prependLoraChain(wf, bfs, { model: ['q:cache', 0] }, 'qwen21:bfs')

      // User LoRA stack — every rgthree slot written explicitly, gaps compacted,
      // a fifth LoRA chained upstream (the stack stops at four).
      const loras = selectedLoras(params)
      for (let i = 0; i < 4; i++) {
        const slot = `0${i + 1}`
        wf['q:loras'].inputs[`lora_${slot}`] = loras[i]?.name ?? 'None'
        wf['q:loras'].inputs[`strength_${slot}`] = loras[i]?.strength ?? 1
      }
      const loraSrc = prependLoraChain(
        wf,
        loras.slice(4),
        { model: editSrc.model, clip: wf['q:loras'].inputs.clip as [string, number] },
        'lora:x',
      )
      wf['q:loras'].inputs.model = loraSrc.model
      wf['q:loras'].inputs.clip = loraSrc.clip

      // ControlNet patches the main pass's model (Z-Image's Fun path, Qwen's
      // file). Before the schedule swap, which copies the patched model across.
      // The Edit preset has neither ControlNet nor a base image: its canvas is
      // picture 1, and leftovers from another preset's session must not rewire it.
      if (!v.edit) appendZImageControlNet(wf, params, { ksamplerId: 'q:sampler', vae: ['q:vae', 0], model: QWEN21_FUN_MODEL })

      // Base-image modes rewire the KSampler's latent and set its denoise. The
      // returned ref is what downstream passes read (outpaint's seam composite).
      const decoded: [string, number] = v.edit
        ? ['q:decode', 0]
        : appendImg2Img(wf, params, { ksamplerId: 'q:sampler', vae: ['q:vae', 0], decoded: ['q:decode', 0] })
      wf['q:save'].inputs.images = decoded

      // The distilled schedule, in every mode. Expert Mode keeps it too: the
      // same model on a stock KSampler schedule is the ghosting leg of the
      // Turbo pick, so only the sampler and CFG are the user's here
      // (expert-sampler.ts rewrites only KSamplers, so it leaves this one alone).
      if (v.sigmas) {
        // With pictures the canvas is picture 1 at ~1024² of area.
        // ponytail: a base image's own size is unknown here, so its μ comes
        // from the form's canvas — μ moves ~0.1 across the 1 MP ladder.
        const [w, h] = refs.length > 0 ? [1024, 1024] : [params.width, params.height]
        const expert = params.expertMode === true
        applyDistilledSchedule(
          wf, v.sigmas(w, h), seed,
          (expert && params.sampler) || 'euler',
          expert ? params.cfg ?? 1 : 1,
        )
      }

      const faceFromModel = params.faceSwapSource === 'model'
      const faceSwapActive = Boolean(
        params.faceSwap && (faceFromModel ? params.faceModel : params.inputImage),
      )

      if (params.upscale !== false) {
        appendHiresFix(wf, {
          saveNodeId: 'q:save',
          imageSource: decoded,
          model: ['q:loras', 0],
          positive: ['q:enc', 0],
          negative: ['q:enc', 1],
          vae: ['q:vae', 0],
          upscaleModel: '4x-UltraSharp.pth',
          netScale: 1.5,
          modelScale: 4,
          sampler: { steps: v.refineSteps ?? v.steps, cfg: 1, ...QWEN21_REFINE, denoise: 0.15, seed },
        })
      }

      // Forced on whenever a swap is active: without a detailer in the graph,
      // Krea2 returned black frames after the first swap of a session, and the
      // order (detailer, then swap) is what keeps the swapped identity. See
      // krea2.ts and swap-detailer-order.test.ts.
      if (params.detailer !== false || faceSwapActive) {
        appendFaceDetailer(wf, {
          saveNodeId: 'q:save',
          model: ['q:loras', 0],
          clip: ['q:loras', 1],
          vae: ['q:vae', 0],
          positive: ['q:enc', 0],
          negative: ['q:enc', 1],
          sampler: { steps: v.refineSteps ?? v.steps, cfg: 1, ...QWEN21_REFINE, denoise: 0.25 },
        })
      }

      if (faceSwapActive) {
        appendFaceSwap(wf, {
          saveNodeId: 'q:save',
          ...(faceFromModel ? { faceModelName: params.faceModel! } : { faceFilename: params.inputImage! }),
          swapModel: params.faceSwapModel,
          pixelBoost: params.faceSwapPixelBoost,
          pixelBoostSize: params.faceSwapPixelBoostSize,
          identity: params.faceSwapIdentity,
        })
      }

      appendFilmGrain(wf, 'q:save', { intensity: 0.04 })
      dropDecodeAlpha(wf)
      return wf
    },
  }
}

export const qwen21TurboWorkflow = qwen21Preset({
  id: 'qwen21-turbo',
  name: 'Qwen-Image 2.1 Turbo',
  description: `Fast 6-step Qwen-Image 2.1 — the everyday model. ${QWEN21_EXPERIMENTAL}`,
  unet: QWEN21_TURBO_UNET,
  steps: 6,
  sigmas: viggleSigmas,
})

export const qwen21BaseWorkflow = qwen21Preset({
  id: 'qwen21',
  name: 'Qwen-Image 2.1',
  description: `Full 40-step Qwen-Image 2.1 — slower, highest fidelity. ${QWEN21_EXPERIMENTAL}`,
  unet: QWEN21_BASE_UNET,
  steps: 40,
  refineSteps: 12,
})

/**
 * The Edit preset runs the Turbo: spec M1 (qwen21-edit-pick.live.test.ts,
 * 2026-10-02) put it level with the 40-step base on an outfit transfer, a
 * background change and both BFS head swaps × 2 seeds — clean on all 16, on
 * par to the eye — at 7.6 s against 26 s.
 */
export const qwen21EditWorkflow = qwen21Preset({
  id: 'qwen21-edit',
  name: 'Qwen-Image 2.1 Edit',
  description: `Edit by instruction: references, head swap, character sheets. ${QWEN21_EXPERIMENTAL}`,
  unet: QWEN21_TURBO_UNET,
  steps: 6,
  sigmas: viggleSigmas,
  edit: true,
})

/** The base model on the edit path: M1's other leg and the model the BFS
 *  comparison (qwen21-bfs-ab.live.test.ts) measured. Not registered. */
export const qwen21EditBaseCandidate = qwen21Preset({
  id: 'qwen21-edit-base',
  name: 'Qwen-Image 2.1 Edit (base)',
  description: 'Edit on the 40-step base',
  unet: QWEN21_BASE_UNET,
  steps: 40,
  refineSteps: 12,
  edit: true,
})

export type EditChip = NonNullable<GenerationParams['editChip']>
export type BfsVariant = NonNullable<GenerationParams['bfsVariant']>

const CHIP_TEXT: Record<EditChip, string> = { bfs: QWEN21_BFS_PROMPT, sheet: QWEN21_SHEET_PROMPT }

/**
 * A chip click. On: its instruction replaces the prompt (switching chips too).
 * Clicking the active chip turns it off and empties the prompt only if it
 * still holds the chip's text untouched — an edited instruction is the user's.
 */
export function toggleEditChip(current: EditChip | undefined, prompt: string, chip: EditChip): { editChip: EditChip | undefined; prompt: string } {
  if (current === chip) return { editChip: undefined, prompt: prompt === CHIP_TEXT[chip] ? '' : prompt }
  return { editChip: chip, prompt: CHIP_TEXT[chip] }
}

/**
 * Simple's "What to do" buttons: one is always lit, so picking the lit one
 * changes nothing, and "Change something" (no chip) turns the chip off.
 */
export function pickEditTask(current: EditChip | undefined, prompt: string, task: EditChip | undefined): { editChip: EditChip | undefined; prompt: string } {
  if (task === current) return { editChip: current, prompt }
  return toggleEditChip(current, prompt, (task ?? current)!)
}

/** Why an edit cannot be queued yet, or null. `bfsReady`: the chosen BFS file is listed. */
export function qwen21EditProblem(pictures: string[] | undefined, chip: EditChip | undefined, bfsReady: boolean): string | null {
  const n = pictures?.length ?? 0
  if (n === 0) return 'Pick a picture to edit first'
  if (chip === 'bfs' && !bfsReady) return 'Get the BFS head-swap LoRA on the Models page first'
  if (chip === 'bfs' && n < 2) return 'Add the head to bring in (picture 2)'
  return null
}

/**
 * Upload name for an edit picture. uploadImageBlob overwrites, so a fixed name
 * would make every picture the last one uploaded. Not crypto.randomUUID: it is
 * undefined outside a secure context, i.e. on a plain-http LAN install.
 */
export function editUploadName(): string {
  return `qwen-edit-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}.png`
}

/** Generate on the Edit preset with `imageUrl` as picture 1 — the gallery's
 *  "Edit with Qwen" and, with the sheet chip, "Character sheet". */
export function qwen21EditHref(imageUrl: string, chip?: 'sheet'): string {
  const q = new URLSearchParams({ workflow: 'qwen21-edit', ref: imageUrl })
  if (chip) q.set('chip', chip)
  return `/generate?${q}`
}

/**
 * What a gallery link does to the form once its picture is uploaded: the
 * picture becomes picture 1 alone — a restored session's old pictures would
 * otherwise come first — the chip is the link's (sheet) or none, and the
 * instruction starts fresh: a `?workflow=` link skips the session restore, so
 * the prompt then holds the first preset's default, junk as an instruction.
 */
export function qwen21EditLinkPatch(picture: string, sheet: boolean): Pick<GenerationParams, 'qwenReferences' | 'editChip' | 'prompt'> {
  return sheet
    ? { qwenReferences: [picture], editChip: 'sheet', prompt: QWEN21_SHEET_PROMPT }
    : { qwenReferences: [picture], editChip: undefined, prompt: '' }
}

/**
 * Whether the head-swap chip is disabled: it turns on once a BFS build is
 * listed, and can always be turned off — a session restored after the files
 * went, or loaded while ComfyUI was still starting, must not leave it stuck on.
 */
export function headSwapChipDisabled(installed: Record<BfsVariant, boolean>, chip: EditChip | undefined): boolean {
  return chip !== 'bfs' && !installed.alternative && !installed['v1.1']
}

/** The BFS build a head swap uses: the user's pick, else the default
 *  (Alternative) unless only v1.1 is installed. */
export function bfsVariantFor(picked: BfsVariant | undefined, installed: Record<BfsVariant, boolean>): BfsVariant {
  if (picked) return picked
  return !installed.alternative && installed['v1.1'] ? 'v1.1' : 'alternative'
}

/** Images per job. An edit renders one — the encode node's latent is a single
 *  picture — so a batch size carried over from another preset must not count. */
export function jobBatchSize(workflow: Pick<WorkflowDefinition, 'referenceSlots'>, params: Pick<GenerationParams, 'batchSize'>): number {
  return workflow.referenceSlots ? 1 : params.batchSize ?? 1
}
