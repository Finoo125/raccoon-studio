import type { ComfyUIPrompt } from '@/types/comfyui'
import type { VideoGenerationParams } from '@/types/video-workflow'
import { minimaxH3Workflow, h3Profile, H3_REF2VA_CKPT } from '@/lib/workflows/minimax-h3'
import { videoParams } from './helper-handoff'

/** The model's full canvas: 736x1344 for the helper's 736x1344 pictures (owner's HELPER_BUDGET_MP=1.0, 2026-10-14). */
export const HELPER_BUDGET_MP = 1

/**
 * The fixed form values every helper render uses — one source for the live harness (`live/helper-video.live.test.ts`)
 * and /api/helper/render, so a manual render and a Claude run make the same graph.
 *
 * The Generate Video form's settings the handoff does not carry, from the owner's last reference-mode job
 * (2026-09-13), minus RIFE and the video face swap (owner, 2026-10-13: "do not use rife and face swap"), and with the
 * realism LoRA off (clip 1 test: no visible difference on this woman; the owner chose to continue without it), and
 * Hi-Fi references off: four 'max'-size references + a Continue's frozen prefix crossed the int32 token limit, the
 * guard fell back to eager and a continue clip sampled at 204 s/step (~30 min a clip).
 *
 * 2026-10-14, the owner's new setup after that day's tests ("the videos look very good"): Eros beta6 (the handoff's
 * 'eros'), realism LoRA ON, no grain / sharpen / upscale, high tier (the tests' size; Continue now renders at the
 * tier's budget instead of growing off the upscaled clip, so the old speed trap is gone).
 *
 * 2026-10-15, the owner's look test (Hotel Confession review): realism LoRA OFF — fal's H3 Realism People LoRA was
 * trained on weathered skin and kept it; with the new look pictures and skin sentence, no LoRA looked youngest.
 */
export const HELPER_FORM: Partial<VideoGenerationParams> = {
  videoModel: 'minimax-h3', fps: 24, pov: true, povGender: 'male', dialogueTier: 'talkative', energy: 8,
  rife: false, swapFaces: false, vramMode: 'high', faceId: false, motionLora: false, turbo: false,
  refHiFi: false, ref2vTurbo: true, filmGrain: false, realismLora: false, sharpen: false, singleShot: true, upscale: false,
  seedHunt: false,
} as Partial<VideoGenerationParams>

const SEED_SPACE = 0xffffffffffff
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** A helper payload (`{ v: 1, workflowId: 'minimax-h3', params }`) as a ComfyUI graph, its seed and the files it loads. */
export function helperGraph(payload: unknown, randomSeed = () => Math.floor(Math.random() * SEED_SPACE)):
  { graph: ComfyUIPrompt; seed: number; files: { unet: string; loras: string[] } } | { error: string } {
  if (!isObj(payload) || payload.v !== 1 || payload.workflowId !== 'minimax-h3' || !isObj(payload.params)) return { error: 'Invalid helper payload' }
  const prefill = videoParams(payload.params)
  if (!prefill) return { error: 'Invalid helper payload' }
  // Resolved here rather than left to buildPrompt (which draws its own for seed < 0) so the route can report it.
  const seed = typeof prefill.seed === 'number' ? prefill.seed : randomSeed()
  const params = { ...minimaxH3Workflow.defaultParams, ...HELPER_FORM, ...prefill, seed, budgetMp: HELPER_BUDGET_MP } as VideoGenerationParams
  const graph = minimaxH3Workflow.buildPrompt(params)
  const profile = h3Profile(params)
  // Helper payloads are always reference mode (videoParams refuses anything else), so 'base' loads the ref2va file.
  const unet = profile?.ckpt ?? H3_REF2VA_CKPT
  const loras = [
    ...(profile && 'lora' in profile ? [profile.lora.name] : []),
    ...[params.lora1, params.lora2].filter((n): n is string => !!n),
  ]
  return { graph, seed, files: { unet, loras } }
}

export type HistoryEntry = {
  status?: { completed?: boolean; status_str?: string; messages?: [string, Record<string, unknown>][] }
  outputs?: Record<string, { images?: { filename: string; subfolder?: string; type?: string }[] }>
}

/** What /history says about one prompt, in the helper's words; `queued` = ComfyUI's queue still holds it. */
export function renderStatus(entry: HistoryEntry | undefined, queued: boolean):
  { status: 'queued' | 'running' | 'done' | 'error' | 'unknown'; files: string[]; error?: string } {
  if (!entry) return { status: queued ? 'queued' : 'unknown', files: [] }
  if (entry.status?.status_str === 'error') {
    const msg = entry.status.messages?.find(([m]) => m === 'execution_error')?.[1]?.exception_message
    return { status: 'error', files: [], error: typeof msg === 'string' ? msg : 'ComfyUI reported an error' }
  }
  if (!entry.status?.completed) return { status: 'running', files: [] }
  // Core SaveVideo reports its mp4 under `images` (see output-media.ts); temp previews are not results.
  // ComfyUI on Windows writes the subfolder with backslashes ("video\MinimaxH3\2026-10-16").
  const files = Object.values(entry.outputs ?? {}).flatMap((o) => (o.images ?? [])
    .filter((f) => !f.type || f.type === 'output')
    .map((f) => [f.subfolder, f.filename].filter(Boolean).join('/').replace(/\\/g, '/')))
  return { status: 'done', files }
}
