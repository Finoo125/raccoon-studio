import {
  defaultColorWheels, defaultHslMixer, defaultToneCurve, editorId, ZERO_ADJUSTMENTS,
  type EditState, type Preset,
} from './types'

const KEY = 'raccoon.photo-edit.presets'

/**
 * User presets live in localStorage, not on disk: they are a UI preference, and
 * the editor already treats everything else about a session as ephemeral.
 *
 * Everything is read defensively — a preset saved by an older build can be
 * missing whole fields, and one bad entry must not take the strip down with it.
 */
export function loadUserPresets(): Preset[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((p): p is Preset =>
      !!p && typeof p.id === 'string' && typeof p.name === 'string' && !!p.adjustments,
    ).map((p) => ({ ...p, custom: true }))
  } catch {
    return []
  }
}

function write(presets: Preset[]): Preset[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(presets))
  } catch {
    // Quota or a locked-down browser profile — the preset is lost, the edit is not.
  }
  return presets
}

/** Capture the current look. Geometry and masks are deliberately left out: a
 *  preset is a look, and a crop from another image is never the right crop. */
export function presetFromState(name: string, state: EditState): Preset {
  return {
    id: editorId('user'),
    name,
    custom: true,
    adjustments: { ...state.adjustments },
    curve: structuredClone(state.curve),
    hsl: structuredClone(state.hsl),
    wheels: structuredClone(state.wheels),
  }
}

export function saveUserPreset(preset: Preset): Preset[] {
  // Same name replaces, so re-saving a tweaked look doesn't pile up duplicates.
  const rest = loadUserPresets().filter((p) => p.name !== preset.name)
  return write([...rest, preset])
}

export function deleteUserPreset(id: string): Preset[] {
  return write(loadUserPresets().filter((p) => p.id !== id))
}

/** The edit-state fields a user preset restores, with defaults for absent ones. */
export function stateFromPreset(preset: Preset): Pick<EditState, 'adjustments' | 'curve' | 'hsl' | 'wheels'> {
  return {
    adjustments: { ...ZERO_ADJUSTMENTS, ...preset.adjustments },
    curve: preset.curve ? structuredClone(preset.curve) : defaultToneCurve(),
    hsl: preset.hsl ? structuredClone(preset.hsl) : defaultHslMixer(),
    wheels: preset.wheels ? structuredClone(preset.wheels) : defaultColorWheels(),
  }
}
