import type { ComfyUIPrompt, ComfyUIPromptNode } from '@/types/comfyui'
import type { VideoWorkflowDefinition, VideoGenerationParams } from '@/types/video-workflow'
import baseWorkflow from '../../../workflows/LTX23-Director.json'
import { ORIENTATIONS, tierOf, loraStackData, ltxDimsForImage, BUDGET_MP } from './ltx23'
import {
  emptyTimeline, guideShots, toDirectorInputs, totalFrames, type DirectorTimeline,
} from './director-timeline'

type Wf = Record<string, ComfyUIPromptNode>
const BASE = baseWorkflow as unknown as Wf

function idOf(cls: string): string {
  const ids = Object.keys(BASE).filter((k) => BASE[k].class_type === cls)
  if (ids.length !== 1) throw new Error(`LTX23-Director.json: expected 1 ${cls}, found ${ids.length}`)
  return ids[0]
}

/**
 * The Director nodes carry stable hand-written ids from the build script rather
 * than being looked up by class: there are two `LTXDirectorGuide`s and the two
 * passes are not interchangeable, so a class lookup could not tell them apart.
 */
const DIR_ID = 'dir'
const GUIDE_IDS = ['dirguide1', 'dirguide2'] as const
for (const id of [DIR_ID, ...GUIDE_IDS]) {
  if (!BASE[id]) throw new Error(`LTX23-Director.json: missing node '${id}'`)
}

const LORA_ID = idOf('RaccoonLoraStack')
const SEED_ID = idOf('Seed (rgthree)')
const RIFE_ID = idOf('RIFEInterpolation')
const CHUNK_ID = idOf('LTXVChunkFeedForward')
const DURATION_ID = idOf('JWFloat')
const FPS_ID = idOf('PrimitiveInt')
const SAVE_ID = Object.keys(BASE).filter(
  (k) => BASE[k].class_type === 'VHS_VideoCombine' && BASE[k].inputs.save_output === true,
)[0]
const PRUNE_ID = idOf('VHS_PruneOutputs')
/** Video VAE, reused for the FaceID reinforcer's own encode. */
const VIDEO_VAE = BASE[GUIDE_IDS[0]].inputs.vae as [string, number]

/** Same reinforcer settings as the i2v path — see the notes in ltx23.ts. */
const FACE_ID_SETTINGS = {
  face_padding: 0.2,
  crop_zoom_factor: 2,
  spatial_gating: 'mask_soft',
  placement_mode: 'i2v_safe',
  source_id: 2,
  phase_scale: 1,
  debug: false,
} as const

const EPSILON = { sharp: 0.001, soft: 0.5 } as const

/**
 * Resize methods that return EXACTLY the requested box.
 *
 * This matters far more than it looks. When the timeline has keyframes the node
 * throws away `custom_width`/`custom_height` and takes the whole clip's latent
 * size from the first keyframe *after resizing it*
 * (ltx_director.py, `if idx == 0: derived_w/h = tensor.shape`). Under
 * 'maintain aspect ratio' that resize fits the image INSIDE the box and returns
 * something smaller — so a 1280x704 render with a portrait keyframe silently
 * delivered 704x704. Only these three cover the box exactly.
 */
const EXACT_RESIZE = ['crop', 'pad', 'pad green', 'stretch to fit'] as const
type ResizeMethod = (typeof EXACT_RESIZE)[number]

export const ltx23DirectorWorkflow: VideoWorkflowDefinition = {
  id: 'ltx23-director',
  name: 'LTX 2.3 Director',
  description:
    'Timeline-driven video: per-segment prompts, keyframes, audio and motion reference in one continuous render',
  orientations: ORIENTATIONS.map(({ label, value }) => ({ label, value })),
  defaultParams: {
    mode: 'director',
    orientation: 'landscape',
    durationSeconds: 15,
    fps: 30,
    seed: -1,
    vramMode: 'high',
    promptBoundary: 'sharp',
  },
  buildPrompt(params: VideoGenerationParams): ComfyUIPrompt {
    const wf = JSON.parse(JSON.stringify(baseWorkflow)) as Wf

    // No timeline (a rerun of a legacy job, or the form's first render) degrades
    // to one segment carrying `prompt`, which the node treats as plain t2v.
    const timeline: DirectorTimeline = params.timeline ?? {
      ...emptyTimeline(params.durationSeconds, params.fps ?? 30),
      globalPrompt: params.prompt ?? '',
    }
    // Duration and fps live on the form, not inside the timeline, so a change to
    // either has to reach the serializer before frames are computed.
    const t: DirectorTimeline = {
      ...timeline,
      durationSeconds: params.durationSeconds,
      fps: params.fps ?? 30,
    }

    const tier = tierOf(params.vramMode)
    const frames = totalFrames(t)

    // Dimensions. The node takes the clip's latent size from the FIRST keyframe
    // in start order, so when we know that image's pixel size we fit the render
    // to its aspect — same rule the i2v path already uses — and the crop below
    // becomes a no-op. Without it, fall back to the orientation the user picked.
    const guides = guideShots(t)
    const firstKf = guides[0]
    const o = ORIENTATIONS.find((x) => x.value === params.orientation) ?? ORIENTATIONS[1]
    const [finalW, finalH] =
      firstKf?.width && firstKf?.height
        ? (({ w, h }) => [w, h] as [number, number])(
            ltxDimsForImage(firstKf.width, firstKf.height, BUDGET_MP[tier]),
          )
        : o.dims[tier]

    const d = wf[DIR_ID].inputs
    Object.assign(d, toDirectorInputs(t))
    d.global_prompt = t.globalPrompt
    d.duration_seconds = t.durationSeconds
    d.end_second = t.durationSeconds
    d.start_second = 0
    d.duration_frames = frames
    d.end_frame = frames
    d.start_frame = 0
    d.frame_rate = t.fps
    // Director builds the FIRST-PASS latent, which the tail then upscales x2 —
    // so these are half the delivered size, not the delivered size. Both halves
    // stay divisible by 32 because ORIENTATIONS is divisible by 64.
    d.custom_width = Math.round(finalW / 2)
    d.custom_height = Math.round(finalH / 2)
    // Never 'maintain aspect ratio' — see EXACT_RESIZE.
    d.resize_method = (
      EXACT_RESIZE.includes(params.keyframeFit as ResizeMethod) ? params.keyframeFit : 'crop'
    ) as ResizeMethod
    d.epsilon = EPSILON[params.promptBoundary ?? 'sharp']
    // A lane counts as active only when it is switched on AND has something in
    // it — the serializer already drops a switched-off lane's contents, so these
    // must agree with it or the node would wait on an empty track.
    d.use_custom_audio = t.audioOn !== false && t.audio.length > 0
    d.use_custom_motion = t.motionOn !== false && t.motion.length > 0
    d.inpaint_audio = t.audioInpaint !== false

    // Motion segments are inert without the IC-LoRA that reads them, so only
    // arm the lane when a LoRA is actually selected.
    const icLora =
      t.motionOn !== false && t.motion.length > 0
        ? (t.motionIcLora ?? params.motionIcLora ?? 'None')
        : 'None'
    for (const gid of GUIDE_IDS) {
      wf[gid].inputs.ic_lora_name = icLora
      wf[gid].inputs.ic_lora_strength = params.motionIcLoraStrength ?? 1
      wf[gid].inputs.retake_mode = t.retake !== undefined
    }

    // Identity lock. Unlike i2v — where it REPLACES reference conditioning —
    // there is nothing to replace here: Director owns the guide path. The
    // reinforcer is inserted as an extra model patch between each pass's guide
    // and its NAG node, taking a keyframe as the reference image.
    // A video guide's file would 400 on LoadImage, so only a still can stand in.
    const faceRef = params.faceIdImage ?? guides.find((s) => s.kind !== 'video')?.file
    const faceId = params.faceId === true && !!faceRef
    if (faceId) {
      wf['faceid_ref'] = {
        class_type: 'LoadImage',
        _meta: { title: 'FaceID reference' },
        inputs: { image: faceRef as string, upload: 'image' },
      }
      GUIDE_IDS.forEach((gid, i) => {
        const nagId = Object.keys(wf).find(
          (k) => wf[k].class_type === 'LTX2_NAG' && (wf[k].inputs.model as [string, number])?.[0] === gid,
        )
        if (!nagId) throw new Error(`LTX23-Director.json: no LTX2_NAG fed by ${gid}`)
        const fid = `faceid_${i}`
        wf[fid] = {
          class_type: 'RaccoonLTXFaceIdentity',
          _meta: { title: `Raccoon LTX Face Identity (pass ${i + 1})` },
          inputs: {
            model: [gid, 3],
            vae: VIDEO_VAE,
            reference_image: ['faceid_ref', 0],
            target_latent: [gid, 2],
            identity_strength: params.faceIdStrength ?? 1,
            auto_face_crop: params.faceIdWholeSubject !== true,
            ...FACE_ID_SETTINGS,
          },
        }
        wf[nagId].inputs.model = [fid, 0]
      })
    }

    // Chunked feedforward costs nothing off the low tier — the node
    // short-circuits to a passthrough at chunks=1.
    wf[CHUNK_ID].inputs.chunks = tier === 'low' ? 3 : 1
    wf[DURATION_ID].inputs.value = t.durationSeconds
    wf[FPS_ID].inputs.value = t.fps
    wf[SEED_ID].inputs.seed =
      params.seed < 0 ? Math.floor(Math.random() * 9999999999999) : params.seed
    wf[LORA_ID].inputs.stack_data = loraStackData(params, faceId)

    // Seed hunt: drop the two output nodes terminating the upscale branch so
    // ComfyUI prunes it and the job stops after the half-size first pass, whose
    // own VideoCombine already writes a temp mp4. Identical to the ltx23 path,
    // and placed the same way — after the LoRA stack, before the RIFE splice.
    if (params.seedHunt) {
      delete wf[SAVE_ID]
      delete wf[PRUNE_ID]
      return wf as unknown as ComfyUIPrompt
    }

    if (params.rife === false) {
      wf[SAVE_ID].inputs.images = wf[RIFE_ID].inputs.images
      wf[SAVE_ID].inputs.frame_rate = wf[RIFE_ID].inputs.source_fps
      delete wf[RIFE_ID]
    }

    wf[SAVE_ID].inputs.filename_prefix =
      'video/LTX23/%year%-%month%-%day%/%hour%%minute%%second%-LTX23Director_'

    return wf as unknown as ComfyUIPrompt
  },
}
