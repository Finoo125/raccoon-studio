import { describe, it, expect } from 'vitest'
import { TEMPLATES, assemblePrompt, randomSelection } from './templates'

describe('prompt-builder templates', () => {
  it('defines the same 20 categories, in the same order, for both modes', () => {
    const ids = (m: 'photoreal' | 'anime') => TEMPLATES[m].map((c) => c.id)
    const expected = [
      'subject', 'bodytype', 'complexion', 'hair', 'clothing', 'womensclothing',
      'underwear', 'bikinis', 'accessories', 'location', 'timeweather', 'pose',
      'expression', 'lighting', 'camera', 'composition', 'color', 'artstyle',
      'mood', 'quality',
    ]
    expect(ids('photoreal')).toEqual(expected)
    expect(ids('anime')).toEqual(expected)
  })

  it('every category offers at least 20 options in both modes', () => {
    for (const mode of ['photoreal', 'anime'] as const) {
      for (const cat of TEMPLATES[mode]) {
        expect(cat.options.length, `${mode}/${cat.id}`).toBeGreaterThanOrEqual(20)
      }
    }
  })

  it('has dedicated underwear and bikini categories in both modes', () => {
    const optIds = (m: 'photoreal' | 'anime', cat: string) =>
      TEMPLATES[m].find((c) => c.id === cat)!.options.map((o) => o.id)
    for (const m of ['photoreal', 'anime'] as const) {
      expect(optIds(m, 'bikinis')).toContain('string-bikini')
      expect(optIds(m, 'underwear')).toContain('lingerie')
      expect(optIds(m, 'womensclothing').length).toBeGreaterThanOrEqual(20)
      // the general clothing category no longer carries swimwear/underwear
      expect(optIds(m, 'clothing')).not.toContain('string-bikini')
    }
  })

  it('every option id is unique within its category', () => {
    for (const mode of ['photoreal', 'anime'] as const) {
      for (const cat of TEMPLATES[mode]) {
        const ids = cat.options.map((o) => o.id)
        expect(new Set(ids).size).toBe(ids.length)
      }
    }
  })

  it('photoreal and anime quality boosters differ', () => {
    const q = (m: 'photoreal' | 'anime') =>
      TEMPLATES[m].find((c) => c.id === 'quality')!.options.map((o) => o.fragment).join('|')
    expect(q('photoreal')).not.toEqual(q('anime'))
  })

  it('assembles selected fragments in category order, comma-joined', () => {
    const subj = TEMPLATES.photoreal[0].options[0]
    const loc = TEMPLATES.photoreal.find((c) => c.id === 'location')!.options[0]
    const out = assemblePrompt('photoreal', { location: [loc.id], subject: [subj.id] })
    expect(out).toBe(`${subj.fragment}, ${loc.fragment}`)
  })

  it('dedupes repeated fragments and ignores unknown ids', () => {
    const subj = TEMPLATES.anime[0].options[0]
    const out = assemblePrompt('anime', { subject: [subj.id, subj.id, 'nope'] })
    expect(out).toBe(subj.fragment)
  })

  it('returns empty string when nothing is selected', () => {
    expect(assemblePrompt('photoreal', {})).toBe('')
  })

  it('randomSelection picks the first option per category when rng=0', () => {
    const sel = randomSelection('photoreal', () => 0)
    for (const cat of TEMPLATES.photoreal) {
      expect(sel[cat.id]).toEqual([cat.options[0].id])
    }
  })

  it('randomSelection picks the last option per category when rng→1', () => {
    const sel = randomSelection('anime', () => 0.999999)
    for (const cat of TEMPLATES.anime) {
      expect(sel[cat.id]).toEqual([cat.options[cat.options.length - 1].id])
    }
  })

  it('randomSelection assembles to a non-empty prompt covering every category', () => {
    const sel = randomSelection('photoreal', () => 0.5)
    expect(Object.keys(sel).length).toBe(TEMPLATES.photoreal.length)
    expect(assemblePrompt('photoreal', sel).length).toBeGreaterThan(0)
  })
})
