import { describe, it, expect } from 'vitest'
import { clearSection, sectionStatus, SECTION_ORDER, adjustmentLabel, CONTROL_HINT } from './sections'
import { ADJUSTMENT_KEYS, defaultEditState, ZERO_ADJUSTMENTS } from './types'

describe('sectionStatus', () => {
  it('reports nothing modified for a fresh edit', () => {
    const state = defaultEditState()
    for (const id of SECTION_ORDER) {
      expect(sectionStatus(id, state), id).toEqual({ modified: false, summary: '' })
    }
  })

  it('summarises slider groups, newest values inline', () => {
    const state = defaultEditState()
    state.adjustments.exposure = 20
    state.adjustments.contrast = -15
    expect(sectionStatus('light', state)).toEqual({
      modified: true, summary: 'Exposure +20, Contrast -15',
    })
  })

  it('caps the summary at three values and counts the rest', () => {
    const state = defaultEditState()
    state.adjustments.exposure = 1
    state.adjustments.contrast = 2
    state.adjustments.highlights = 3
    state.adjustments.shadows = 4
    state.adjustments.whites = 5
    expect(sectionStatus('light', state).summary).toBe('Exposure +1, Contrast +2, Highlights +3, +2 more')
  })

  it('rolls the mixer and grading wheels into the colour section', () => {
    const state = defaultEditState()
    state.adjustments.warmth = 10
    state.hsl.blue.sat = -30
    state.hsl.red.lum = 5
    state.wheels.shadows = { hue: 200, sat: 40, lum: 0 }
    expect(sectionStatus('color', state).summary).toBe('Temperature +10, Mixer (2), Grading')
  })

  it('names the curve channels that were touched', () => {
    const state = defaultEditState()
    state.curve.r = [{ x: 0, y: 0 }, { x: 128, y: 160 }, { x: 255, y: 255 }]
    expect(sectionStatus('curve', state)).toEqual({ modified: true, summary: 'R' })
    state.curve.rgb = [{ x: 0, y: 20 }, { x: 255, y: 255 }]
    expect(sectionStatus('curve', state).summary).toBe('RGB, R')
  })

  it('describes geometry without opening the section', () => {
    const state = defaultEditState()
    state.crop = { x: 0, y: 0, w: 0.5, h: 0.75 }
    state.rotate = 90
    state.flipH = true
    expect(sectionStatus('crop', state).summary).toBe('50×75%, 90°, flip H')
  })

  it('counts masks and notes a slice', () => {
    const state = defaultEditState()
    state.masks = [{
      id: 'm', kind: 'radial', name: 'R', invert: false, feather: 50,
      adjustments: { ...ZERO_ADJUSTMENTS },
    }]
    expect(sectionStatus('masks', state).summary).toBe('1 mask')
    state.slice = { ax: 0, ay: 0, bx: 1, by: 1, keep: 'a' }
    expect(sectionStatus('slice', state).modified).toBe(true)
  })
})

describe('clearSection', () => {
  const dirty = () => {
    const s = defaultEditState()
    s.adjustments.exposure = 20      // light
    s.adjustments.warmth = 30        // color
    s.adjustments.clarity = 40       // presence
    s.adjustments.grain = 50         // effects
    s.hsl.blue.sat = -30
    s.wheels.highlights = { hue: 40, sat: 60, lum: 0 }
    s.curve.rgb = [{ x: 0, y: 10 }, { x: 255, y: 255 }]
    s.crop = { x: 0, y: 0, w: 0.5, h: 0.5 }
    s.rotate = 90
    s.masks = [{ id: 'm', kind: 'radial', name: 'R', invert: false, feather: 50, adjustments: { ...ZERO_ADJUSTMENTS } }]
    s.slice = { ax: 0, ay: 0, bx: 1, by: 1, keep: 'a' }
    s.filter = { id: 'mono', intensity: 0.5 }
    return s
  }

  // The point of a per-section reset is that it is surgical.
  it('clears only its own section', () => {
    for (const id of SECTION_ORDER) {
      const cleared = clearSection(id, dirty())
      expect(sectionStatus(id, cleared).modified, `${id} cleared itself`).toBe(false)
      for (const other of SECTION_ORDER) {
        if (other === id) continue
        expect(sectionStatus(other, cleared).modified, `${id} left ${other} alone`).toBe(true)
      }
    }
  })

  it('colour takes the mixer and wheels with it', () => {
    const cleared = clearSection('color', dirty())
    expect(cleared.hsl).toEqual(defaultEditState().hsl)
    expect(cleared.wheels).toEqual(defaultEditState().wheels)
    expect(cleared.adjustments.exposure).toBe(20)   // light untouched
  })

  it('crop clears rotation and flips too', () => {
    const cleared = clearSection('crop', dirty())
    expect(cleared.crop).toBeNull()
    expect(cleared.rotate).toBe(0)
    expect(cleared.flipH).toBe(false)
  })
})

describe('adjustmentLabel', () => {
  it('renames warmth to the term photographers use', () => {
    expect(adjustmentLabel('warmth')).toBe('Temperature')
    expect(adjustmentLabel('highlights')).toBe('Highlights')
  })
})

describe('CONTROL_HINT', () => {
  it('explains every adjustment slider', () => {
    // A renamed adjustment would otherwise silently lose its help line, since
    // SliderRow looks the hint up by the label it happens to render.
    for (const key of ADJUSTMENT_KEYS) {
      const label = adjustmentLabel(key)
      expect(CONTROL_HINT[label], `no hint for "${label}"`).toBeTruthy()
    }
  })

  it('covers the controls that are not adjustments', () => {
    for (const label of ['Feather', 'Range from', 'Range to', 'Brush size', 'Blending', 'Balance', 'Angle']) {
      expect(CONTROL_HINT[label], `no hint for "${label}"`).toBeTruthy()
    }
  })

  it('keeps every line short enough for a 288px column', () => {
    for (const [label, hint] of Object.entries(CONTROL_HINT)) {
      expect(hint.length, `"${label}" is ${hint.length} chars`).toBeLessThanOrEqual(64)
      expect(hint.endsWith('.'), `"${label}" should read as a sentence`).toBe(true)
    }
  })
})
