import type { ComfyUIPrompt } from '@/types/comfyui'
import type { GenerationParams } from '@/types/workflow'
import type { LoraFamily } from '@/lib/models/lora-family'

/**
 * Shared LoRA plumbing for the image workflows.
 *
 * Each family injects LoRAs differently — SDXL builds a `LoraLoader` chain,
 * Z-Image and Ernie fill an rgthree "Lora Loader Stack", Anima has a single
 * `LoraLoaderModelOnly` — and two of those have a hard slot ceiling (four for
 * the rgthree stack, one for Anima). `prependLoraChain` is the escape hatch: it
 * hangs extra loaders *upstream* of whatever the template already wires.
 */

/**
 * Slots available without a warning. Beyond this the styles start fighting each
 * other and output quality degrades, so the form asks for confirmation first.
 */
export const FREE_LORA_SLOTS = 2

/**
 * Ceiling on rows the form offers. The builders take any number — see the
 * arbitrary-N test in lora-chain.test.ts — so this is a quality/VRAM guard, not
 * a structural one: past a handful the patches fight and each one still costs a
 * load. ponytail: raise it if someone has a real use for more.
 */
export const MAX_LORAS = 10

/** A LoRA the user actually picked. `strength` stays optional so each workflow
 *  keeps its own historical default (Ernie's first slot uses 0.9, not 1). */
export interface SelectedLora {
  name: string
  strength?: number
}

export const DEFAULT_LORA_PARAMS: SelectedLora[] = Array.from(
  { length: FREE_LORA_SLOTS },
  () => ({ name: '', strength: 1 }),
)

/**
 * The LoRA rows to show after a preset switch. Presets that share a LoRA pool
 * (SDXL/Pony/Illustrious) keep the live stack — the same files load on all of
 * them. Across families the outgoing stack cannot load, so the incoming
 * preset's own last stack comes back instead, or empty rows on a first visit.
 * A file uninstalled in between is dropped by the picker's stale guard.
 */
export function lorasForSwitch(
  live: SelectedLora[] | undefined,
  fromFamily: LoraFamily | undefined,
  toFamily: LoraFamily | undefined,
  stashed: SelectedLora[] | undefined,
): SelectedLora[] {
  const shared = Boolean(fromFamily) && fromFamily === toFamily
  return (shared ? live : stashed) ?? DEFAULT_LORA_PARAMS.map((lora) => ({ ...lora }))
}

type Ref = [string, number]

/** The set LoRA slots, in order, with the empty ones dropped. */
export function selectedLoras(params: GenerationParams): SelectedLora[] {
  return (params.loras ?? [])
    .filter((lora) => Boolean(lora.name))
    .map(({ name, strength }) => ({ name, strength }))
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
