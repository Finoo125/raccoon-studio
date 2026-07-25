import type { ComfyUIPrompt } from '@/types/comfyui'
import type { GenerationParams } from '@/types/workflow'

/**
 * Shared LoRA plumbing for the image workflows.
 *
 * Each family injects LoRAs differently — SDXL builds a `LoraLoader` chain,
 * Z-Image and Ernie fill an rgthree "Lora Loader Stack", Anima has a single
 * `LoraLoaderModelOnly` — and two of those have a hard slot ceiling (four for
 * the rgthree stack, one for Anima). `prependLoraChain` is the escape hatch: it
 * hangs extra loaders *upstream* of whatever the template already wires.
 */

/** Hard ceiling on LoRA slots the form offers. */
export const MAX_LORAS = 5

/**
 * Slots available without a warning. Beyond this the styles start fighting each
 * other and output quality degrades, so the form asks for confirmation first.
 */
export const FREE_LORA_SLOTS = 2

/** A LoRA the user actually picked. `strength` stays optional so each workflow
 *  keeps its own historical default (Ernie's first slot uses 0.9, not 1). */
export interface SelectedLora {
  name: string
  strength?: number
}

/** The param keys behind each slot, in slot order — lets the form render N rows
 *  and the reset paths clear them all without spelling out ten field names. */
export const LORA_SLOTS: { name: keyof GenerationParams; strength: keyof GenerationParams }[] = [
  { name: 'lora1', strength: 'lora1Strength' },
  { name: 'lora2', strength: 'lora2Strength' },
  { name: 'lora3', strength: 'lora3Strength' },
  { name: 'lora4', strength: 'lora4Strength' },
  { name: 'lora5', strength: 'lora5Strength' },
]

/**
 * Every LoRA slot cleared. Spread over params wherever selections must not
 * survive — a new session, or a model switch — since a LoRA that was since
 * uninstalled (or belongs to another family) fails ComfyUI validation.
 */
export const EMPTY_LORA_PARAMS = Object.fromEntries(
  LORA_SLOTS.flatMap((s) => [[s.name, ''], [s.strength, 1]]),
) as Partial<GenerationParams>

type Ref = [string, number]

/** The set LoRA slots, in order, with the empty ones dropped. */
export function selectedLoras(params: GenerationParams): SelectedLora[] {
  return ([
    [params.lora1, params.lora1Strength],
    [params.lora2, params.lora2Strength],
    [params.lora3, params.lora3Strength],
    [params.lora4, params.lora4Strength],
    [params.lora5, params.lora5Strength],
  ] as const)
    .filter((l): l is readonly [string, number | undefined] => Boolean(l[0]))
    .map(([name, strength]) => ({ name, strength }))
}

/**
 * Insert a LoRA loader chain **upstream** of an existing model/clip consumer and
 * return the new source refs to feed it.
 *
 * Upstream rather than downstream on purpose: LoRA patches are additive, so
 * chain order carries no meaning, and prepending means no existing wire in the
 * template has to be hunted down and repointed — the consumer keeps its node id
 * and everything downstream of it is untouched.
 *
 * Passing a `clip` ref builds `LoraLoader` nodes (model + clip); omitting it
 * builds `LoraLoaderModelOnly` (Anima, whose text encoder is a Qwen LLM the
 * LoRAs don't patch).
 */
export function prependLoraChain(
  wf: ComfyUIPrompt,
  loras: SelectedLora[],
  src: { model: Ref; clip?: Ref },
  idPrefix: string,
): { model: Ref; clip?: Ref } {
  let model = src.model
  let clip = src.clip

  loras.forEach((lora, i) => {
    const id = `${idPrefix}:${i}`
    const strength = lora.strength ?? 1
    wf[id] = clip
      ? {
          class_type: 'LoraLoader',
          inputs: { lora_name: lora.name, strength_model: strength, strength_clip: strength, model, clip },
        }
      : {
          class_type: 'LoraLoaderModelOnly',
          inputs: { lora_name: lora.name, strength_model: strength, model },
        }
    model = [id, 0]
    if (clip) clip = [id, 1]
  })

  return { model, clip }
}
