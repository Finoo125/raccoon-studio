import type { GenerationParams, LoraParam, WorkflowDefinition } from '@/types/workflow'
import { lorasForSwitch } from '@/lib/workflows/lora-chain'
import { swapPromptPrefix } from '@/lib/workflows/anime-prompts'

/**
 * The form's params after switching preset `from` → `to` — what the preset
 * button does, shared with the gallery's Edit links so a link lands exactly as
 * a click would. Everything the target does not set in its `defaultParams`
 * (detailer, tiled VAE decode, job count, face swap…) stays the user's.
 *
 * The description follows the user; only the family's default text swaps
 * (Pony's score ladder for Illustrious's booru tags, nothing at all for the
 * photoreal families). LoRAs are family-specific (an SDXL LoRA won't load on
 * Z-Image), so they only travel between presets that share a pool; across
 * families the incoming preset's own last stack (`stashed`) comes back.
 */
export function switchPresetParams(
  p: GenerationParams,
  from: WorkflowDefinition,
  to: WorkflowDefinition,
  stashed: LoraParam[] | undefined,
): GenerationParams {
  return {
    ...p,
    ...to.defaultParams,
    loras: lorasForSwitch(p.loras, from.loraFamily, to.loraFamily, stashed),
    prompt: swapPromptPrefix(p.prompt, from.defaultParams.prompt, to.defaultParams.prompt),
    negativePrompt: swapPromptPrefix(p.negativePrompt ?? '', from.defaultParams.negativePrompt, to.defaultParams.negativePrompt),
  }
}
