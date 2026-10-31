/**
 * What Simple renders with (spec §2–§4). The form keeps one set of values; in
 * Simple, handleGenerate lays these over them before building the job, so every
 * Advanced value survives a round trip through Simple. The same lists name what
 * an arriving job needs Advanced for.
 *
 * Adding an Advanced-only control? Add its key here, or Simple renders with it.
 */
import type { GenerationParams, WorkflowDefinition } from '@/types/workflow'
import type { VideoGenerationParams } from '@/types/video-workflow'
import { KREA2_KROMA_DEFAULT } from './krea2'

/**
 * Every setting of each form, placed: `kept` = Simple shows it, or the form/builder fills it
 * (injected filenames, per-machine facts); `reset` = hidden in Simple, so the overlay below
 * sets it. A new key fails tsc until it is placed here, and simple-values.test.ts fails until
 * a `reset` key is in the overlay (spec §4, the hidden-keys guard).
 */
type Place = 'kept' | 'reset'
export const IMAGE_KEYS: Record<keyof GenerationParams, Place> = {
  prompt: 'kept', width: 'kept', height: 'kept', batchSize: 'kept', upscale: 'kept', detailer: 'kept',
  ariaModel: 'kept', ariaModelStrength: 'kept',
  sdxlVae: 'kept', krea2RefusalLora: 'kept', krea2KromaLora: 'kept', krea2ProjectorLora: 'kept', qwen21Enhancer: 'kept',
  // Simple's Edit steps show the pictures and the task; the head swap always uses the default build
  qwenReferences: 'kept', editChip: 'kept',
  negativePrompt: 'reset', seed: 'reset', jobCount: 'reset',
  expertMode: 'reset', steps: 'reset', cfg: 'reset', sampler: 'reset', scheduler: 'reset',
  loras: 'reset', promptEnhancer: 'reset',
  krea2Nsfw: 'reset', krea2KromaStrength: 'reset', krea2ProjectorStrength: 'reset',
  bfsVariant: 'reset',
  faceSwap: 'reset', inputImage: 'reset', faceSwapModel: 'reset', faceSwapPixelBoost: 'reset',
  faceSwapPixelBoostSize: 'reset', faceSwapIdentity: 'reset', faceSwapSource: 'reset', faceModel: 'reset',
  tiledVaeDecode: 'reset', tiledVaeTileSize: 'reset',
  baseImage: 'reset', editMode: 'reset', denoise: 'reset', maskImage: 'reset', outpaint: 'reset',
  controlNet: 'reset', ipAdapter: 'reset',
}
export const VIDEO_KEYS: Record<keyof VideoGenerationParams, Place> = {
  prompt: 'kept', videoModel: 'kept', orientation: 'kept', durationSeconds: 'kept', fps: 'kept', vramMode: 'kept', budgetMp: 'kept',
  inputImage: 'kept', inputImageWidth: 'kept', inputImageHeight: 'kept', refImages: 'kept', refImageRoles: 'kept',
  h3Checkpoint: 'kept', h3Sampler: 'reset', turbo: 'kept', ref2vTurbo: 'kept', continueFrom: 'kept',
  mode: 'reset', seed: 'reset', seedHunt: 'reset',
  endImage: 'reset', endImageWidth: 'reset', endImageHeight: 'reset', keyframes: 'reset',
  refVideos: 'reset', refAudios: 'reset', refHiFi: 'reset', singleShot: 'reset',
  pov: 'reset', povGender: 'reset', music: 'reset', environment: 'reset', scenario: 'reset',
  camera: 'reset', dialogueTier: 'reset', energy: 'reset',
  realismLora: 'reset', rife: 'reset', upscale: 'reset', filmGrain: 'reset', sharpen: 'reset', swapFaces: 'reset',
  faceId: 'reset', faceIdImage: 'reset', faceIdStrength: 'reset', faceIdWholeSubject: 'reset',
  motionLora: 'reset', motionIcLora: 'reset', motionIcLoraStrength: 'reset',
  lora1: 'reset', lora1Strength: 'reset', lora2: 'reset', lora2Strength: 'reset',
  lora3: 'reset', lora3Strength: 'reset', lora4: 'reset', lora4Strength: 'reset',
  editSource: 'reset', editKind: 'reset', editSourceWidth: 'reset', editSourceHeight: 'reset',
  editSourceFrames: 'reset', editSourceHasAudio: 'reset', editJoin: 'reset', editPictures: 'reset',
  editPictureRoles: 'reset', editSwapFace: 'reset', editFaceChecked: 'reset', editFirstFrame: 'reset',
  editDescribeWith: 'reset', editPictureNotes: 'reset', editFollow: 'reset',
  timeline: 'reset', promptBoundary: 'reset', keyframeFit: 'reset',
}

export function simpleImageValues(w: WorkflowDefinition): Partial<GenerationParams> {
  return {
    expertMode: false,
    steps: w.defaultParams.steps,
    cfg: w.defaultParams.cfg,
    sampler: w.defaultParams.sampler,
    scheduler: w.defaultParams.scheduler,
    loras: [],
    negativePrompt: w.defaultParams.negativePrompt ?? '',
    seed: -1,
    jobCount: 1,
    promptEnhancer: false,
    bfsVariant: undefined,
    faceSwap: false,
    inputImage: undefined, faceSwapModel: undefined, faceSwapPixelBoost: undefined, faceSwapPixelBoostSize: undefined,
    faceSwapIdentity: undefined, faceSwapSource: undefined, faceModel: undefined,
    baseImage: undefined,
    editMode: undefined,
    denoise: undefined,
    maskImage: undefined,
    outpaint: undefined,
    controlNet: undefined,
    ipAdapter: undefined,
    tiledVaeDecode: false,
    tiledVaeTileSize: undefined,
    krea2Nsfw: 'patch',
    krea2KromaStrength: KREA2_KROMA_DEFAULT,
    krea2ProjectorStrength: w.defaultParams.krea2ProjectorStrength,
  }
}

export type SimpleVideoMode = 't2v' | 'i2v' | 'ref2v'
const SIMPLE_VIDEO_MODES: readonly string[] = ['t2v', 'i2v', 'ref2v']

/** Edit and Director live in Advanced; a session left in one renders as text-to-video in Simple. */
export function simpleVideoMode(mode: VideoGenerationParams['mode']): SimpleVideoMode {
  return SIMPLE_VIDEO_MODES.includes(mode) ? (mode as SimpleVideoMode) : 't2v'
}

export function simpleVideoValues(p: VideoGenerationParams, opts: { motionReady: boolean; realismReady?: boolean }): Partial<VideoGenerationParams> {
  return {
    mode: simpleVideoMode(p.mode),
    endImage: undefined,
    endImageWidth: undefined,
    endImageHeight: undefined,
    keyframes: undefined,
    h3Sampler: undefined,
    refVideos: undefined,
    refAudios: undefined,
    refHiFi: false,
    singleShot: false,
    seedHunt: false,
    // The Enhance panel's choices also shape LTX's negative prompt (ltx23.ts). Simple pins them on
    // purpose to what the writer is told (simpleLtxSettings, video-picks.ts) — keep the two equal:
    // no POV (the male-POV negatives are inert then) and standard talking. music stays undefined:
    // LTX23.json's saved "None — LLM decides" is the no-music key (the node reads any "None…" so).
    pov: false, dialogueTier: 'standard',
    povGender: undefined, music: undefined, environment: undefined, scenario: undefined,
    camera: undefined, energy: undefined,
    faceId: false, faceIdImage: undefined, faceIdStrength: undefined, faceIdWholeSubject: undefined,
    // LTX's Stabilised motion is on by default whenever its LoRA is installed (video-form-context).
    motionLora: opts.motionReady,
    motionIcLora: undefined, motionIcLoraStrength: undefined,
    // Edit and Director data: inert once mode is mapped, cleared so nothing reads a stale source
    editSource: undefined, editKind: undefined, editSourceWidth: undefined, editSourceHeight: undefined,
    editSourceFrames: undefined, editSourceHasAudio: undefined, editJoin: undefined, editPictures: undefined,
    editPictureRoles: undefined, editSwapFace: undefined, editFaceChecked: undefined, editFirstFrame: undefined,
    editDescribeWith: undefined, editPictureNotes: undefined, editFollow: undefined,
    timeline: undefined, promptBoundary: undefined, keyframeFit: undefined,
    // undefined = each builder's own default (H3: off; LTX keeps RIFE on)
    rife: undefined,
    filmGrain: undefined,
    // H3's realism adapter is on whenever its LoRA is installed, like the motion LoRA (video-form-context).
    realismLora: opts.realismReady === true,
    sharpen: undefined,
    upscale: undefined,
    swapFaces: undefined,
    lora1: '', lora2: '', lora3: '', lora4: '',
    lora1Strength: undefined, lora2Strength: undefined, lora3Strength: undefined, lora4Strength: undefined,
    seed: -1,
  }
}

const has = (s: string | undefined) => typeof s === 'string' && s.length > 0
const once = (xs: string[]) => [...new Set(xs)]

/** Why params arriving from the gallery or a link need Advanced; [] = Simple can render them. */
export function advancedImageReasons(incoming: Partial<GenerationParams>, w: WorkflowDefinition): string[] {
  const r: string[] = []
  if (incoming.loras?.some((l) => has(l.name))) r.push('LoRAs')
  if (w.supportsNegativePrompt && has(incoming.negativePrompt) && incoming.negativePrompt !== (w.defaultParams.negativePrompt ?? '')) {
    r.push('a negative prompt')
  }
  if (incoming.expertMode) r.push('Expert mode')
  if (incoming.faceSwap) r.push('face swap')
  if (incoming.baseImage) r.push('a starting picture')
  if (incoming.controlNet || incoming.ipAdapter) r.push('reference guidance')
  if (incoming.tiledVaeDecode) r.push('tiled decoding')
  // A preset switch keeps other families' fields (switchPresetParams spreads them), so only the family's own count.
  if (w.loraFamily === 'krea2' && (
      (incoming.krea2Nsfw && incoming.krea2Nsfw !== 'patch') ||
      (incoming.krea2KromaStrength !== undefined && incoming.krea2KromaStrength !== KREA2_KROMA_DEFAULT) ||
      (incoming.krea2ProjectorStrength !== undefined && incoming.krea2ProjectorStrength !== w.defaultParams.krea2ProjectorStrength))) {
    r.push('NSFW settings')
  }
  if (w.referenceSlots && incoming.editChip === 'bfs' && incoming.bfsVariant === 'v1.1') r.push('the v1.1 head swap')
  if (incoming.promptEnhancer) r.push('the prompt enhancer')
  return once(r)
}

export function advancedVideoReasons(incoming: Partial<VideoGenerationParams>, huntCount = 0): string[] {
  const r: string[] = []
  if (incoming.mode === 'edit') r.push('Edit video')
  if (incoming.mode === 'director') r.push('Director')
  if (incoming.endImage) r.push('an end frame')
  if (incoming.keyframes && Object.values(incoming.keyframes).some(Boolean)) r.push('keyframes')
  if (incoming.refVideos?.some(Boolean) || incoming.refAudios?.some(Boolean)) r.push('reference clips or sounds')
  if ([incoming.lora1, incoming.lora2, incoming.lora3, incoming.lora4].some(has)) r.push('LoRAs')
  if (incoming.refHiFi) r.push('high-fidelity references')
  if (incoming.singleShot) r.push('one continuous shot')
  if (incoming.faceId) r.push('identity lock')
  if (incoming.filmGrain || incoming.realismLora || incoming.sharpen || incoming.upscale || incoming.swapFaces) r.push('finishing touches')
  if (incoming.seedHunt || huntCount > 1) r.push('several takes')
  return once(r)
}

export type Shape = 'portrait' | 'square' | 'landscape'
const SHAPE_WORD: Record<Shape, string> = { portrait: 'Portrait', square: 'Square', landscape: 'Landscape' }

export function shapeOf(width: number, height: number): Shape {
  return width < height ? 'portrait' : width > height ? 'landscape' : 'square'
}

/** Simple's three shape buttons: each shape's "Portrait / Square / Landscape" ratio, else its first. */
export function simpleShapes<R extends { label: string; width: number; height: number }>(ratios: R[]): { shape: Shape; ratio: R }[] {
  return (['portrait', 'square', 'landscape'] as const).flatMap((shape) => {
    const same = ratios.filter((r) => shapeOf(r.width, r.height) === shape)
    const ratio = same.find((r) => r.label.startsWith(SHAPE_WORD[shape])) ?? same[0]
    return ratio ? [{ shape, ratio }] : []
  })
}

/**
 * Simple's model cards: every preset this install can run, in the setup's order,
 * once, plus the current pick, so Simple never silently swaps the model.
 */
export function simplePresetIds(order: string[], usable: (id: string) => boolean, current: string): string[] {
  const ids = [...new Set(order)].filter(usable)
  return ids.includes(current) ? ids : [...ids, current]
}
