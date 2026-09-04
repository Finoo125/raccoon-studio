/**
 * Character-sheet mode: one toggle instead of "go find the right LoRA for this
 * model, then remember its trigger word".
 *
 * A character sheet — the same figure drawn from several angles at one scale —
 * is what MiniMax H3's reference mode wants for a consistent character. Every
 * family the app ships has a community LoRA that produces one, but each has a
 * different filename and a different trigger, and a forgotten trigger is a
 * silent no-op: the render succeeds and simply isn't a sheet. This table is the
 * one place that knowledge lives.
 *
 * Injection follows the same confirm-then-inject rule as the Krea2 built-ins:
 * the form only sets `characterSheetLora` once ComfyUI actually reports the
 * file, because an unknown `lora_name` is rejected with `value_not_in_list` and
 * surfaces as a bare "Generation failed". A missing file therefore degrades to
 * a normal render instead of breaking the job.
 */

import type { LoraFamily } from '@/lib/models/lora-family'
import type { ModelAsset } from '@/lib/models/ltx23-assets'

/**
 * Where the mirrorable LoRAs are served from.
 *
 * A GitHub **release asset**, deliberately not a file in the repo: releases are
 * free, do not count toward repo size, and never land in anyone's clone — while
 * 380 MB committed to the tree is paid for by every user on every `git pull`,
 * forever. (It would not even be possible: GitHub hard-rejects files over
 * 100 MB, and two of these are 162 MB and 218 MB.)
 *
 * One constant, so moving the release — different tag, or the runpod repo
 * instead — is a single edit.
 */
const RELEASE_BASE =
  'https://github.com/Finoo125/raccoon-studio/releases/download/character-sheets-v1'

export interface CharacterSheetPreset {
  family: LoraFamily
  /** Filename in `models/loras/`. */
  file: string
  /**
   * Goes in front of the user's description. Each LoRA was trained on its own
   * phrasing, so this is not interchangeable between families.
   */
  trigger: string
  /** Civitai model page, shown when the file is missing. */
  source: string
  /** Download size in MB. */
  sizeMb: number
  /**
   * Direct download URL, when the creator's licence permits us to mirror it.
   *
   * Absent means "install it by hand" — the Models page already treats a
   * missing `url` that way, and the toggle links the Civitai page instead.
   * Anima's uploader set `allowDerivatives: false` and
   * `allowDifferentLicense: false`, the most restrictive pair Civitai offers,
   * so that one is linked rather than re-hosted.
   */
  url?: string
}

/**
 * Only families with a LoRA that has actually been rendered and looked at.
 * SDXL/Illustrious have many candidates and Ernie has none tested, so both are
 * deliberately absent — the toggle hides rather than offering something unproven.
 */
export const CHARACTER_SHEETS: CharacterSheetPreset[] = [
  {
    family: 'krea2',
    file: 'CharacterDesign-KREA2_v1.safetensors',
    trigger: 'Character design sheet of',
    source: 'https://civitai.com/models/2815175',
    sizeMb: 218,
    url: `${RELEASE_BASE}/CharacterDesign-KREA2_v1.safetensors`,
  },
  {
    family: 'zimage',
    file: 'CharacterDesign-IZT-V1.safetensors',
    trigger: 'CharacterDesignIZT, character design sheet of',
    source: 'https://civitai.com/models/100435',
    sizeMb: 162,
    url: `${RELEASE_BASE}/CharacterDesign-IZT-V1.safetensors`,
  },
  {
    family: 'anima',
    file: 'CharacterSheet-Anima-v1.safetensors',
    trigger: '1girl, multiple views, standing, full body, reference sheet, turnaround,',
    source: 'https://civitai.com/models/2603848',
    sizeMb: 66,
    // No `url`: licence flags forbid re-hosting. Manual import only.
  },
]

/**
 * Appended after the user's description.
 *
 * Three views, not a dense grid: MiniMax's own reference guidance is that
 * "large, sharp subjects and clearly separated sections give H3 stronger visual
 * information than a crowded page of tiny panels". A twelve-cell turnaround is
 * actively worse as a reference than three big ones.
 */
export const CHARACTER_SHEET_LAYOUT =
  'three full-body views: front, side, back, neutral A-pose, ' +
  'identical scale and lighting, plain light grey background'

export function characterSheetFor(family?: LoraFamily): CharacterSheetPreset | undefined {
  return family ? CHARACTER_SHEETS.find((p) => p.family === family) : undefined
}

export function characterSheetByFile(file: string): CharacterSheetPreset | undefined {
  return CHARACTER_SHEETS.find((p) => p.file === file)
}

/**
 * Compose the prompt actually sent: trigger, the user's description, layout.
 *
 * Returns `prompt` untouched for a file with no preset, so a stale persisted
 * filename can never produce a half-built prompt.
 */
export function withCharacterSheet(prompt: string, file: string): string {
  const preset = characterSheetByFile(file)
  if (!preset) return prompt
  const body = prompt.trim().replace(/[,\s]+$/, '')
  const parts = [preset.trigger, body].filter(Boolean).join(' ')
  return `${parts}, ${CHARACTER_SHEET_LAYOUT}`
}

/**
 * Z-Image Turbo renders a **pure black image** once the prompt gets long enough,
 * with no error at all — ComfyUI reports `status_str: success` and writes a
 * black PNG. Measured live 2026-08-23 on ComfyUI 0.30.0, holding seed and
 * resolution fixed and growing only the prompt: 430 characters renders, 440 is
 * black. It is a text-encoder cliff, so the true unit is tokens and the exact
 * cutoff moves with wording — hence a margin below the measured edge.
 *
 * Only Z-Image is affected; Krea2, Anima, SDXL and Ernie all render long
 * prompts fine.
 */
export const ZIMAGE_PROMPT_LIMIT = 400

/**
 * A warning for the prompt that will actually be *sent*, which is not what the
 * user typed when character-sheet mode is on — the trigger and the layout
 * clause add roughly 150 characters, enough on its own to cross the cliff.
 * Returns null when there is nothing to say.
 */
export function promptLengthWarning(
  family: LoraFamily | undefined,
  effectivePrompt: string,
): string | null {
  if (family !== 'zimage') return null
  const n = effectivePrompt.length
  if (n <= ZIMAGE_PROMPT_LIMIT) return null
  return `Z-Image renders a black image past roughly ${ZIMAGE_PROMPT_LIMIT} characters — this prompt is ${n}. Shorten it, or switch model.`
}

/**
 * The same three files as Models-page rows. Derived rather than retyped, so a
 * filename or size can never disagree between the picker and the downloader.
 */
export const CHARACTER_SHEET_ASSETS: ModelAsset[] = CHARACTER_SHEETS.map((preset) => ({
  name: preset.file,
  folder: 'loras',
  sizeMb: preset.sizeMb,
  url: preset.url,
  source: preset.source,
  // Every one of these unlocks character-sheet mode for one family and is
  // needed by no render on its own.
  optional: true,
}))
