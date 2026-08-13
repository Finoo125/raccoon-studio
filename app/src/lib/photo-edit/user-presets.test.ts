import { describe, it, expect, beforeEach } from 'vitest'
import {
  deleteUserPreset, loadUserPresets, presetFromState, saveUserPreset, stateFromPreset,
} from './user-presets'
import { defaultEditState, type Preset } from './types'

const KEY = 'raccoon.photo-edit.presets'

/** Minimal localStorage stand-in — the module only uses getItem/setItem. */
function stubStorage(): Map<string, string> {
  const map = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v) },
    },
  })
  return map
}

describe('user presets', () => {
  let store: Map<string, string>
  beforeEach(() => { store = stubStorage() })

  it('round-trips a saved look', () => {
    const state = defaultEditState()
    state.adjustments.exposure = 30
    state.curve.rgb = [{ x: 0, y: 0 }, { x: 128, y: 180 }, { x: 255, y: 255 }]
    state.hsl.blue.sat = -40
    state.wheels.shadows = { hue: 200, sat: 50, lum: 10 }

    saveUserPreset(presetFromState('Moody', state))
    const [loaded] = loadUserPresets()

    expect(loaded.name).toBe('Moody')
    expect(loaded.custom).toBe(true)
    const restored = stateFromPreset(loaded)
    expect(restored.adjustments.exposure).toBe(30)
    expect(restored.curve.rgb).toEqual(state.curve.rgb)
    expect(restored.hsl.blue.sat).toBe(-40)
    expect(restored.wheels.shadows).toEqual({ hue: 200, sat: 50, lum: 10 })
  })

  // A crop belonging to a different image is never the crop this one wants.
  it('captures the look but not geometry or masks', () => {
    const state = defaultEditState()
    state.crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }
    state.rotate = 90
    state.masks = [{
      id: 'm', kind: 'radial', name: 'M', invert: false, feather: 50,
      adjustments: state.adjustments,
    }]
    const preset = presetFromState('Look', state) as Preset & Record<string, unknown>
    expect(preset.crop).toBeUndefined()
    expect(preset.rotate).toBeUndefined()
    expect(preset.masks).toBeUndefined()
  })

  it('re-saving the same name replaces rather than duplicates', () => {
    saveUserPreset(presetFromState('Warm', defaultEditState()))
    const second = defaultEditState()
    second.adjustments.warmth = 40
    saveUserPreset(presetFromState('Warm', second))

    const all = loadUserPresets()
    expect(all).toHaveLength(1)
    expect(all[0].adjustments.warmth).toBe(40)
  })

  // Two presets saved in the same millisecond must not share an id, or deleting
  // one takes the other with it.
  it('deletes by id, and ids are unique within a millisecond', () => {
    saveUserPreset(presetFromState('A', defaultEditState()))
    saveUserPreset(presetFromState('B', defaultEditState()))
    const [a, b] = loadUserPresets()
    expect(a.id).not.toBe(b.id)
    expect(deleteUserPreset(a.id).map((p) => p.name)).toEqual(['B'])
  })

  it('survives corrupt or foreign storage instead of taking the strip down', () => {
    store.set(KEY, 'not json at all')
    expect(loadUserPresets()).toEqual([])

    store.set(KEY, JSON.stringify({ not: 'an array' }))
    expect(loadUserPresets()).toEqual([])

    // One bad entry among good ones is dropped, the rest still load.
    store.set(KEY, JSON.stringify([{ id: 'x' }, { id: 'y', name: 'Good', adjustments: {} }]))
    expect(loadUserPresets().map((p) => p.name)).toEqual(['Good'])
  })

  // A preset saved before the curve/mixer/wheels existed must still load.
  it('fills in defaults for fields an older build never saved', () => {
    store.set(KEY, JSON.stringify([{ id: 'old', name: 'Old', adjustments: { contrast: 12 } }]))
    const restored = stateFromPreset(loadUserPresets()[0])
    expect(restored.adjustments.contrast).toBe(12)
    expect(restored.adjustments.exposure).toBe(0)
    expect(restored.curve).toEqual(defaultEditState().curve)
    expect(restored.wheels).toEqual(defaultEditState().wheels)
  })
})
