import { describe, it, expect } from 'vitest'
import {
  CHARACTER_SHEETS,
  CHARACTER_SHEET_ASSETS,
  CHARACTER_SHEET_LAYOUT,
  ZIMAGE_PROMPT_LIMIT,
  characterSheetFor,
  withCharacterSheet,
  promptLengthWarning,
} from './character-sheet'

const KREA2 = 'CharacterDesign-KREA2_v1.safetensors'
const ZIMAGE = 'CharacterDesign-IZT-V1.safetensors'

describe('character sheet presets', () => {
  it('offers one preset per supported family, and none for the untested ones', () => {
    expect(characterSheetFor('krea2')?.file).toBe(KREA2)
    expect(characterSheetFor('zimage')?.file).toBe(ZIMAGE)
    expect(characterSheetFor('anima')?.file).toBe('CharacterSheet-Anima-v1.safetensors')
    // Deliberately absent — nothing has been rendered and looked at for these.
    expect(characterSheetFor('sdxl')).toBeUndefined()
    expect(characterSheetFor('ernie')).toBeUndefined()
    expect(characterSheetFor(undefined)).toBeUndefined()
  })

  it('gives every preset a distinct file', () => {
    const files = CHARACTER_SHEETS.map((p) => p.file)
    expect(new Set(files).size).toBe(files.length)
  })
})

describe('withCharacterSheet', () => {
  it('wraps the description in the family trigger and the layout clause', () => {
    const out = withCharacterSheet('a red-haired woman in a flight jacket', KREA2)
    expect(out.startsWith('Character design sheet of a red-haired woman')).toBe(true)
    expect(out.endsWith(CHARACTER_SHEET_LAYOUT)).toBe(true)
  })

  it('uses each family its own trigger — they are not interchangeable', () => {
    // A forgotten or wrong trigger is a silent no-op: the render succeeds and
    // simply is not a sheet, which is the whole reason this table exists.
    expect(withCharacterSheet('x', ZIMAGE)).toContain('CharacterDesignIZT')
    expect(withCharacterSheet('x', KREA2)).not.toContain('CharacterDesignIZT')
  })

  it('leaves the prompt alone for a file with no preset', () => {
    // A stale persisted filename must not produce a half-built prompt.
    expect(withCharacterSheet('a cat', 'someone-elses-lora.safetensors')).toBe('a cat')
  })

  it('does not double up separators on a prompt that already ends in one', () => {
    expect(withCharacterSheet('a cat,  ', KREA2)).toBe(
      `Character design sheet of a cat, ${CHARACTER_SHEET_LAYOUT}`,
    )
  })
})

describe('promptLengthWarning', () => {
  it('warns only for Z-Image, the only family with the black-frame cliff', () => {
    const long = 'x'.repeat(ZIMAGE_PROMPT_LIMIT + 1)
    expect(promptLengthWarning('zimage', long)).toContain('black')
    expect(promptLengthWarning('krea2', long)).toBeNull()
    expect(promptLengthWarning('anima', long)).toBeNull()
    expect(promptLengthWarning(undefined, long)).toBeNull()
  })

  it('stays quiet at the limit and speaks one character past it', () => {
    expect(promptLengthWarning('zimage', 'x'.repeat(ZIMAGE_PROMPT_LIMIT))).toBeNull()
    expect(promptLengthWarning('zimage', 'x'.repeat(ZIMAGE_PROMPT_LIMIT + 1))).not.toBeNull()
  })

  it('is measured on the composed prompt, not what was typed', () => {
    // Character-sheet mode adds ~150 characters of trigger and layout, which is
    // enough on its own to cross the cliff — a warning on the typed text alone
    // would stay silent right up until the render came back black.
    const typed = 'a '.repeat(140).trim() // ~279 chars: under the limit by itself
    expect(promptLengthWarning('zimage', typed)).toBeNull()
    expect(promptLengthWarning('zimage', withCharacterSheet(typed, ZIMAGE))).not.toBeNull()
  })
})

describe('CHARACTER_SHEET_ASSETS', () => {
  it('mirrors every preset into a loras-folder row', () => {
    expect(CHARACTER_SHEET_ASSETS).toHaveLength(CHARACTER_SHEETS.length)
    for (const a of CHARACTER_SHEET_ASSETS) {
      expect(a.folder).toBe('loras')
      expect(a.optional).toBe(true)
      expect(a.sizeMb).toBeGreaterThan(0)
    }
  })

  it('never offers a download for the LoRA we are not licensed to mirror', () => {
    // Anima's uploader set allowDerivatives:false + allowDifferentLicense:false.
    // A `url` here would put our release link behind a one-click download and
    // start re-hosting it — the failure is legal, not technical, so nothing else
    // in the app would ever catch it.
    const anima = CHARACTER_SHEET_ASSETS.find((a) => a.name.includes('Anima'))
    expect(anima, 'the Anima row exists').toBeTruthy()
    expect(anima!.url, 'Anima must stay a manual import').toBeUndefined()
  })

  it('gives the permissively-licensed two a real release URL', () => {
    for (const name of ['CharacterDesign-KREA2_v1.safetensors', 'CharacterDesign-IZT-V1.safetensors']) {
      const a = CHARACTER_SHEET_ASSETS.find((x) => x.name === name)
      expect(a?.url, `${name} has a download URL`).toMatch(/^https:\/\/github\.com\/.+\/releases\/download\//)
      // The uploaded asset has to be named exactly what the loader expects, or
      // the download saves fine and ComfyUI still reports the file missing.
      expect(a!.url!.endsWith(name), `${name} URL ends with the loader filename`).toBe(true)
    }
  })
})
