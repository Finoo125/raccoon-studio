import type { ComfyUIPrompt, ComfyUIPromptNode } from '@/types/comfyui'
import type { VideoWorkflowDefinition, VideoGenerationParams } from '@/types/video-workflow'
import baseWorkflow from '../../../workflows/LTX23.json'

type Wf = Record<string, ComfyUIPromptNode>
const BASE = baseWorkflow as unknown as Wf

/** Id of the single node of `cls` in the base workflow — throws at module load if not exactly one. */
function idOf(cls: string): string {
  const ids = Object.keys(BASE).filter((k) => BASE[k].class_type === cls)
  if (ids.length !== 1) throw new Error(`LTX23.json: expected 1 ${cls}, found ${ids.length}`)
  return ids[0]
}

const PROMPT_ID = idOf('RaccoonVideoPrompt')
const LORA_ID = idOf('RaccoonLoraStack')
const SEED_ID = idOf('Seed (rgthree)')
const RIFE_ID = idOf('RIFEInterpolation')
// duration_s / fps arrive over links from value nodes (JWFloat / PrimitiveInt).
const DURATION_ID = (BASE[PROMPT_ID].inputs.duration_s as [string, number])[0]
const FPS_ID = (BASE[PROMPT_ID].inputs.fps as [string, number])[0]
// The one VideoCombine that saves output writes the final clip; the other is the
// first-pass preview and is left alone.
const SAVE_ID = Object.keys(BASE).filter(
  (k) => BASE[k].class_type === 'VHS_VideoCombine' && BASE[k].inputs.save_output === true,
)[0]

type Tier = NonNullable<VideoGenerationParams['vramMode']>

/** Legacy/unknown stored values render full-size, exactly as they always did. */
const tierOf = (m?: string): Tier => (m === 'low' || m === 'medium' ? m : 'high')

/** Pixel budget per tier, used for the i2v dims fitted to the source aspect. */
const BUDGET_MP: Record<Tier, number> = { high: 2, medium: 1.4, low: 1 }

/**
 * t2v framings — the final size, i.e. after the x2 spatial upscaler.
 *
 * Both sides must be divisible by **64**, not 32: the graph renders the first
 * pass at half this size (LTX23.json node 532, multiplier 0.5) and
 * EmptyLTXVLatentVideo floors `// 32`, so an odd multiple of 32 loses up to
 * 32 px per axis and silently renders smaller than advertised. That also rules
 * out a true 16:9 middle tier — 900 is not /64, hence 896.
 *
 * Square is the same at every tier: 1024² is already ~1MP.
 */
const ORIENTATIONS: { label: string; value: string; dims: Record<Tier, [number, number]> }[] = [
  {
    label: 'Portrait 9:16',
    value: 'portrait',
    dims: { high: [1088, 1920], medium: [896, 1600], low: [704, 1280] },
  },
  {
    label: 'Landscape 16:9',
    value: 'landscape',
    dims: { high: [1920, 1088], medium: [1600, 896], low: [1280, 704] },
  },
  {
    label: 'Square 1:1',
    value: 'square',
    dims: { high: [1024, 1024], medium: [1024, 1024], low: [1024, 1024] },
  },
]

/** Fit an image's aspect into ~budgetMp megapixels, both sides snapped to /64 (see ORIENTATIONS). */
export function ltxDimsForImage(imgW: number, imgH: number, budgetMp = 2): { w: number; h: number } {
  const aspect = imgW / imgH
  const h = Math.sqrt((budgetMp * 1024 * 1024) / aspect)
  const snap = (n: number) => Math.max(64, Math.round(n / 64) * 64)
  return { w: snap(h * aspect), h: snap(h) }
}

/** Always row 0 of the stack — the few-step sampling schedule needs it. */
const DMD_ROW = { on: true, lora: 'LTX2.3_DMD_reshaped_r256.safetensors', str: 1, vs: 1, as: 0.8 }

export const ltx23Workflow: VideoWorkflowDefinition = {
  id: 'ltx23',
  name: 'LTX 2.3 Video',
  description:
    'A/V text- and image-to-video with latent upscale and RIFE interpolation',
  orientations: ORIENTATIONS.map(({ label, value }) => ({ label, value })),
  defaultParams: {
    mode: 't2v',
    orientation: 'landscape',
    durationSeconds: 15,
    fps: 30,
    seed: -1,
    dialogueTier: 'standard',
    energy: 5,
    vramMode: 'high',
  },
  buildPrompt(params: VideoGenerationParams): ComfyUIPrompt {
    const wf = JSON.parse(JSON.stringify(baseWorkflow)) as Wf
    const p = wf[PROMPT_ID].inputs

    // The in-graph LLM stays off — prompts are written via the /rvn routes (Ollama).
    p.confirmed_prompt = params.prompt
    p.video_mode = params.mode
    p.user_intent = ''
    p.image_b64 = ''
    p.model_file = 'None'
    p.mmproj_file = 'None (text-only)'

    // Dropping the pixel budget is the biggest speed lever there is; the low
    // (16 GB) tier also keeps the upscale pass and decode on-card instead of
    // spilling to shared memory.
    const tier = tierOf(params.vramMode)
    if (params.mode === 't2v') {
      const o = ORIENTATIONS.find((x) => x.value === params.orientation) ?? ORIENTATIONS[1]
      p.image_filename = ''
      ;[p.rm_w, p.rm_h] = o.dims[tier]
    } else {
      p.image_filename = params.inputImage ?? ''
      // Without recorded dims (legacy rerun) keep the baked defaults — the node
      // resizes to rm_w×rm_h, so matching the image's aspect avoids distortion.
      if (params.inputImageWidth && params.inputImageHeight) {
        const d = ltxDimsForImage(params.inputImageWidth, params.inputImageHeight, BUDGET_MP[tier])
        p.rm_w = d.w
        p.rm_h = d.h
      }
    }

    // Render-time negative inputs + enhance-parity passthroughs. The node's
    // VALIDATE_INPUTS accepts any string for the preset combos.
    if (params.pov !== undefined) p.pov = params.pov
    if (params.povGender) p.pov_gender = params.povGender
    if (params.music !== undefined) p.music = params.music
    if (params.environment) p.environment = params.environment
    if (params.scenario) p.scenario = params.scenario
    if (params.camera) p.camera_move = params.camera
    if (params.dialogueTier) p.dialogue_tier = params.dialogueTier
    if (params.energy !== undefined) p.intensity = params.energy

    wf[DURATION_ID].inputs.value = params.durationSeconds
    wf[FPS_ID].inputs.value = params.fps ?? 30

    // Seed — resolve a random request to a concrete int so the run is reproducible.
    wf[SEED_ID].inputs.seed =
      params.seed < 0 ? Math.floor(Math.random() * 9999999999999) : params.seed

    // LoRA stack: DMD always on, then the user's slots (unset slot = omitted).
    const rows: Record<string, unknown>[] = [DMD_ROW]
    for (const [lora, str] of [
      [params.lora1, params.lora1Strength],
      [params.lora2, params.lora2Strength],
      [params.lora3, params.lora3Strength],
      [params.lora4, params.lora4Strength],
    ] as [string | undefined, number | undefined][]) {
      if (lora && lora !== 'None') rows.push({ on: true, lora, str: str ?? 1, vs: 1, as: 1 })
    }
    wf[LORA_ID].inputs.stack_data = JSON.stringify(rows)

    // RIFE off: feed the saving combine straight from RIFE's own sources — the
    // raw frames and the base fps (RIFE normally upsamples to a fixed 60).
    if (params.rife === false) {
      wf[SAVE_ID].inputs.images = wf[RIFE_ID].inputs.images
      wf[SAVE_ID].inputs.frame_rate = wf[RIFE_ID].inputs.source_fps
      delete wf[RIFE_ID]
    }

    wf[SAVE_ID].inputs.filename_prefix =
      'video/LTX23/%year%-%month%-%day%/%hour%%minute%%second%-LTX23_'

    return wf as unknown as ComfyUIPrompt
  },
}
