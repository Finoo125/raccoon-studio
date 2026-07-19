import { describe, it, expect } from 'vitest'
import { PRESETS, applyPreset } from './presets'
import { ZERO_ADJUSTMENTS } from './types'

describe('presets', () => {
  it('includes the v1 set, original first', () => {
    expect(PRESETS[0].id).toBe('original')
    expect(PRESETS.map((p) => p.id)).toEqual(
      expect.arrayContaining(['chrome','mono','noir','fade','instant','process','vivid','dramatic','silvertone'])
    )
  })
  it('original is identity at any intensity', () => {
    const out = applyPreset({ ...ZERO_ADJUSTMENTS }, PRESETS[0], 1)
    expect(out).toEqual(ZERO_ADJUSTMENTS)
  })
  it('intensity 0 returns the base unchanged', () => {
    const chrome = PRESETS.find((p) => p.id === 'chrome')!
    const out = applyPreset({ ...ZERO_ADJUSTMENTS }, chrome, 0)
    expect(out).toEqual(ZERO_ADJUSTMENTS)
  })
  it('intensity 1 applies the full preset bundle', () => {
    const chrome = PRESETS.find((p) => p.id === 'chrome')!
    const out = applyPreset({ ...ZERO_ADJUSTMENTS }, chrome, 1)
    expect(out.contrast).toBe(chrome.adjustments.contrast ?? 0)
  })

  it('includes the cinematic grade presets', () => {
    const ids = PRESETS.map((p) => p.id)
    expect(ids).toEqual(
      expect.arrayContaining(['teal-orange', 'sunset', 'cold-blue', 'sepia', 'vintage-film', 'faded-retro']),
    )
  })

  it('grade presets carry a valid ColorGrade', () => {
    for (const id of ['teal-orange', 'sunset', 'cold-blue', 'sepia', 'vintage-film', 'faded-retro']) {
      const p = PRESETS.find((x) => x.id === id)!
      expect(p.grade).toBeDefined()
      expect(p.grade!.shadow).toHaveLength(3)
      expect(p.grade!.highlight).toHaveLength(3)
    }
  })
})
