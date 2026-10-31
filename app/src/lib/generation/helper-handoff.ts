import { H3_REF_BUDGET, H3_REF_MAX } from '@/lib/workflows/minimax-h3'
import type { H3CheckpointId, VideoGenerationParams } from '@/types/video-workflow'
import type { StudioPrefill } from './studio-store'

/**
 * The creator's private link from their own Video Helper app into Generate Video / Generate Image.
 *
 * Unlisted add-on: no key grants it and the Add-ons page never shows it; it is open only where
 * `RACCOON_PRIVATE_ADDONS` names it (the creator's own `.env.local`). Everywhere else the link is ignored.
 *
 * The link carries `?handoff=<base64url JSON>` with pictures the helper already uploaded to ComfyUI's
 * input folder. It only fills the form — nothing renders until the user presses Generate.
 */
export const HELPER_LINK_ADDON = 'video-helper-link'

type Handoff = { page: '/generate-videos' | '/generate'; prefill: StudioPrefill }
type Obj = Record<string, unknown>

const ROLES = ['character', 'face', 'outfit', 'location', 'prop']
const SEGMENT = /^[\w.\- ]+$/
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)
const onlyKeys = (o: Obj, allowed: string[]) => Object.keys(o).every((k) => allowed.includes(k))
/** A relative path of plain segments: no "..", no drive, no scheme, no leading slash. */
const isPath = (x: unknown, maxSegments: number) => {
  if (typeof x !== 'string' || !x || x.length > 300) return false
  const parts = x.split('/')
  return parts.length <= maxSegments && parts.every((p) => SEGMENT.test(p) && p !== '.' && p !== '..')
}
/** A ComfyUI input name: `name` or `subfolder/name`. */
const isInput = (x: unknown) => isPath(x, 2)
const isText = (x: unknown) => typeof x === 'string' && x.length <= 20000
const isSize = (x: unknown) => Number.isInteger(x) && (x as number) > 0 && (x as number) <= 8192

function decode(raw: string): unknown {
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
  } catch {
    return null
  }
}

const CHECKPOINTS: H3CheckpointId[] = ['base', 'eros', 'hybrid', 'sparseref']
const MAX_SEED = Number.MAX_SAFE_INTEGER // 2^53 − 1
/** Samplers the helper may ask for instead of the checkpoint's own (its 2026-10-18 tests: lcm and res_multistep on 10Eros). */
const SAMPLERS = ['euler', 'lcm', 'res_multistep']
/** A LoRA file in ComfyUI's loras folder itself: one plain segment ending in .safetensors. */
const isLoraName = (x: unknown) =>
  typeof x === 'string' && x.length <= 200 && SEGMENT.test(x) && x.endsWith('.safetensors') && !x.includes('..')
const isKeyframe = (k: unknown) =>
  isObj(k) && onlyKeys(k, ['image', 'width', 'height']) && isInput(k.image) && isSize(k.width) && isSize(k.height)

/** The params a helper video payload stands for, or null if anything is off. Shared by the URL handoff and /api/helper/render. */
export function videoParams(p: Obj): StudioPrefill['params'] | null {
  const keys = ['mode', 'h3Checkpoint', 'durationSeconds', 'orientation', 'refImages', 'refImageRoles', 'refAudios', 'keyframes', 'continueFrom', 'prompt', 'loras', 'seed', 'sampler']
  if (!onlyKeys(p, keys)) return null
  const { refImages: refs, refImageRoles: roles, refAudios: audios, keyframes, continueFrom, durationSeconds: d, loras, seed, sampler } = p
  if (p.mode !== 'ref2v' || !CHECKPOINTS.includes(p.h3Checkpoint as H3CheckpointId)) return null
  if (typeof d !== 'number' || !Number.isFinite(d) || d < 5 || d > 15) return null
  if (!['portrait', 'landscape', 'square'].includes(p.orientation as string) || !isText(p.prompt)) return null
  if (!Array.isArray(refs) || refs.length < 1 || refs.length > 6 || !refs.every(isInput)) return null
  if (!Array.isArray(roles) || roles.length !== refs.length || !roles.every((r) => ROLES.includes(r))) return null
  if (audios !== undefined && (!Array.isArray(audios) || audios.length > H3_REF_MAX.audios || !audios.every(isInput))) return null
  if (refs.length + (audios?.length ?? 0) > H3_REF_BUDGET) return null
  if (continueFrom !== undefined && !isPath(continueFrom, 8)) return null
  if (keyframes !== undefined) {
    if (!isObj(keyframes) || !Object.keys(keyframes).length || !onlyKeys(keyframes, ['start', 'end'])) return null
    if (!Object.values(keyframes).every(isKeyframe)) return null
  }
  if (loras !== undefined) {
    if (!Array.isArray(loras) || loras.length > 2) return null
    const ok = (l: unknown) => isObj(l) && onlyKeys(l, ['name', 'strength']) && isLoraName(l.name) &&
      typeof l.strength === 'number' && l.strength >= 0 && l.strength <= 2
    if (!loras.every(ok)) return null
  }
  if (sampler !== undefined && !SAMPLERS.includes(sampler as string)) return null
  if (seed !== undefined && !(Number.isInteger(seed) && (seed as number) >= 0 && (seed as number) <= MAX_SEED)) return null
  const slots = ((loras ?? []) as { name: string; strength: number }[]).reduce<Partial<StudioPrefill['params']>>(
    (acc, l, i) => ({ ...acc, [`lora${i + 1}`]: l.name, [`lora${i + 1}Strength`]: l.strength }), {})
  return {
    videoModel: 'minimax-h3',
    mode: 'ref2v',
    h3Checkpoint: p.h3Checkpoint as H3CheckpointId,
    durationSeconds: d,
    orientation: p.orientation as string,
    refImages: refs as string[],
    refImageRoles: roles as string[],
    refAudios: audios?.length ? (audios as string[]) : undefined,
    prompt: p.prompt as string,
    // Always written, so a link without them clears a continuation or keyframes left in the form.
    continueFrom: continueFrom as string | undefined,
    keyframes: keyframes as StudioPrefill['params']['keyframes'],
    ...(seed !== undefined ? { seed: seed as number } : {}),
    ...(sampler !== undefined ? { h3Sampler: sampler as VideoGenerationParams['h3Sampler'] } : {}),
    ...slots,
  }
}

function videoHandoff(p: Obj): Handoff | null {
  const params = videoParams(p)
  return params ? { page: '/generate-videos', prefill: { workflowId: 'minimax-h3', params } } : null
}

function qwenHandoff(p: Obj): Handoff | null {
  if (!onlyKeys(p, ['qwenReferences', 'prompt'])) return null
  const refs = p.qwenReferences
  if (!Array.isArray(refs) || refs.length < 1 || refs.length > 4 || !refs.every(isInput) || !isText(p.prompt)) return null
  return {
    page: '/generate',
    prefill: { workflowId: 'qwen21-edit', params: { qwenReferences: refs as string[], editChip: undefined, prompt: p.prompt as string } },
  }
}

/** A validated prefill and the page it belongs on, or null for anything that is not exactly a helper link. */
export function parseHandoff(raw: string): Handoff | null {
  const data = decode(raw)
  if (!isObj(data) || data.v !== 1 || !isObj(data.params) || !onlyKeys(data, ['v', 'workflowId', 'params'])) return null
  if (data.workflowId === 'minimax-h3') return videoHandoff(data.params)
  if (data.workflowId === 'qwen21-edit') return qwenHandoff(data.params)
  return null
}
