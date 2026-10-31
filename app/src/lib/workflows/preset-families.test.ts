import { describe, expect, it } from 'vitest'
import { PRESET_GROUPS, presetNameById } from './preset-families'

describe('preset families', () => {
  it('names every preset as family · variant', () => {
    expect(PRESET_GROUPS.map((g) => `${g.label}: ${g.presets.map((p) => p.variant).join('|')}`)).toEqual([
      'Anima: Base|Turbo',
      'Ernie: Turbo',
      'Krea2: Turbo|RAW',
      'Qwen 2.1: Turbo|Base|Edit',
      'Z-Image: Turbo',
      'SDXL: Base|Pony|Illustrious',
    ])
  })

  it('resolves the Models catalog ids, and nothing else', () => {
    expect(presetNameById('z-image-turbo')).toEqual({ family: 'Z-Image', variant: 'Turbo' })
    expect(presetNameById('qwen21')).toEqual({ family: 'Qwen 2.1', variant: 'Base' })
    expect(presetNameById('ltx23')).toBeUndefined()
  })
})
