import type { ComfyUIPrompt } from '@/types/comfyui'
import type { GenerationParams } from '@/types/workflow'

/**
 * Node-id prefix used by every sampler this pass must NOT touch. `hires-fix.ts`
 * appends its resample as `hires:sample`, a second plain KSampler in the same
 * graph; its step count is sized against a low denoise (KSampler slices the
 * schedule by `denoise`, so its "12 steps" is ~2-3 real ones) and is meaningless
 * as a user-facing number. The face detailer needs no exclusion — it is a
 * `FaceDetailer`, not a `KSampler`.
 */
const APPENDED_SAMPLER_PREFIX = 'hires:'

/**
 * Expert Mode: overwrite the main sampler's settings with the user's.
 *
 * Applied as one pass over the finished graph rather than inside each family
 * builder, matching `applyTiledVaeDecode` — sampler choice is a property of the
 * render, not of any one model family, and a family added later gets this
 * without having to know the option exists.
 *
 * Only the *main* sampler is rewritten. Every image template's primary sampler
 * is a plain `KSampler` ('60:19', '88:70', 'k:sampler', '57:3', '3'), and the
 * only appended one is `hires:sample`, so class plus that prefix identifies it.
 *
 * Each of the four values is written only when set, so a form that has never
 * touched (say) the scheduler leaves the family's own choice in place.
 *
 * ponytail: outpaint's OUTPAINT_STEP_MULTIPLIER (img2img.ts) is applied inside
 * buildPrompt, so this pass overwrites the multiplied count rather than scaling
 * the user's. Deliberate — in Expert Mode the number typed is the number that
 * runs. Scale it here instead if outpaints start coming back undercooked.
 *
 * Mutates and returns `wf`: builders hand back a freshly constructed graph each
 * call, so there is nothing shared to protect.
 */
export function applyExpertSampler(wf: ComfyUIPrompt, params: GenerationParams): ComfyUIPrompt {
  if (!params.expertMode) return wf

  for (const [id, node] of Object.entries(wf)) {
    if (node.class_type !== 'KSampler') continue
    if (id.startsWith(APPENDED_SAMPLER_PREFIX)) continue
    if (params.steps !== undefined) node.inputs.steps = params.steps
    if (params.cfg !== undefined) node.inputs.cfg = params.cfg
    if (params.sampler) node.inputs.sampler_name = params.sampler
    if (params.scheduler) node.inputs.scheduler = params.scheduler
  }
  return wf
}

/**
 * Whether a negative prompt does anything for this render — i.e. whether the
 * form should show the box.
 *
 * At CFG 1 the sampler runs no unconditional pass, so there is nothing for a
 * negative prompt to steer away from. That is exactly why the distilled families
 * declare `supportsNegativePrompt: false`. Once Expert Mode can move CFG, the
 * question stops being a property of the family and becomes one of the live
 * value — in both directions: an expert who drops SDXL to CFG 1 loses the box
 * for the same reason a turbo user above CFG 1 gains it.
 */
export function negativePromptApplies(
  params: GenerationParams,
  workflow: { supportsNegativePrompt: boolean; defaultParams: { cfg?: number } },
): boolean {
  if (!params.expertMode) return workflow.supportsNegativePrompt
  return (params.cfg ?? workflow.defaultParams.cfg ?? 1) > 1
}
