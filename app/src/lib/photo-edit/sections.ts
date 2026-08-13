import {
  ADJUSTMENT_GROUPS, defaultColorWheels, defaultHslMixer, defaultToneCurve,
  HUE_BANDS, ZERO_ADJUSTMENTS,
  type Adjustments, type EditState, type ToneCurve,
} from './types'
import { isIdentityCurve } from './curve'
import { isIdentityMixer } from './adjustments'
import { isNeutralWheels } from './color-wheels'

export type SectionId =
  | 'presets' | 'light' | 'color' | 'curve' | 'presence' | 'effects'
  | 'crop' | 'masks' | 'slice'

/** Panel order, top to bottom. Modes (crop/masks/slice) sit at the bottom. */
export const SECTION_ORDER: SectionId[] = [
  'presets', 'light', 'color', 'curve', 'presence', 'effects', 'crop', 'masks', 'slice',
]

export const SECTION_LABEL: Record<SectionId, string> = {
  presets: 'Presets',
  light: 'Light',
  color: 'Color',
  curve: 'Tone curve',
  presence: 'Presence',
  effects: 'Effects',
  crop: 'Crop & rotate',
  masks: 'Masks',
  slice: 'Slice',
}

/** One line of plain English per section, shown on first run and when empty. */
export const SECTION_HINT: Record<SectionId, string> = {
  presets: 'A one-click look. Save your own from the current edit.',
  light: 'Exposure and the tonal range — the brightness of the whole frame and of its ends.',
  color: 'White balance, saturation, and per-colour control. Grading wheels tint shadows, midtones and highlights separately.',
  curve: 'Direct control over how input brightness maps to output. Click the line to add a point.',
  presence: 'Local contrast. Texture works on fine detail, Clarity on midtones, Dehaze on atmospheric haze.',
  effects: 'Finishing: sharpening, a darkened edge, and film grain.',
  crop: 'Reframe and straighten. Drag the corners on the image.',
  masks: 'Limit an adjustment to part of the image — darken a sky, brighten a face.',
  slice: 'Cut the image along a straight line and keep one side.',
}

/**
 * One line of plain English per control, keyed by the label the slider shows.
 *
 * Aimed at someone who has never opened Lightroom: the pairs that trip everyone
 * up (Highlights vs Whites, Shadows vs Blacks, Vibrance vs Saturation) say what
 * makes them *different*, not what they do in the abstract. Keyed by label so a
 * slider looks its own help up — a mask's Exposure gets the same line as the
 * global one, because it means the same thing.
 */
export const CONTROL_HINT: Record<string, string> = {
  // Light
  Exposure: 'Overall brightness of the whole picture.',
  Contrast: 'The gap between the dark and bright parts.',
  Highlights: 'The bright areas. Pull down to rescue a blown-out sky.',
  Shadows: 'The dark areas. Push up to reveal hidden detail.',
  Whites: 'The very brightest point — where white begins.',
  Blacks: 'The very darkest point — where black begins.',
  // Colour
  Temperature: 'Warmer (orange) or cooler (blue).',
  Tint: 'The other half of white balance: green to magenta.',
  Vibrance: 'Lifts muted colours only, and leaves skin alone.',
  Saturation: 'Lifts every colour equally, skin included.',
  // Presence
  Texture: 'Fine detail — skin, hair, fabric.',
  Clarity: 'Punch in the midtones. Gets harsh past about 40.',
  Dehaze: 'Cuts through mist and flat, washed-out air.',
  // Effects
  Sharpness: 'Crisps up edges. A little goes a long way.',
  Vignette: 'Darkens the corners to pull the eye inward.',
  Grain: 'Film-like speckle. Hides plastic-looking skin.',
  // Colour grading
  Blending: 'How strongly the three wheels apply.',
  Balance: 'Shifts the split between shadows and highlights.',
  // Crop
  Angle: 'Tilt a fraction of a degree to level the horizon.',
  // Masks
  Feather: 'How soft the mask edge is. 0 is a hard cut.',
  'Range from': 'Only pixels brighter than this are affected.',
  'Range to': 'Only pixels darker than this are affected.',
  'Brush size': 'How wide the brush paints.',
}

/** Sections whose controls only make sense with their canvas overlay showing. */
export const SECTION_MODE: Partial<Record<SectionId, 'crop' | 'masks' | 'slice'>> = {
  crop: 'crop', masks: 'masks', slice: 'slice',
}

/** Which slider group each adjustment section owns, by index into ADJUSTMENT_GROUPS. */
const GROUP_OF: Partial<Record<SectionId, number>> = {
  light: 0, color: 1, presence: 2, effects: 3,
}

const RENAMED: Partial<Record<keyof Adjustments, string>> = { warmth: 'Temperature' }

export function adjustmentLabel(key: keyof Adjustments): string {
  return RENAMED[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

export function groupKeys(id: SectionId): (keyof Adjustments)[] {
  const i = GROUP_OF[id]
  return i === undefined ? [] : ADJUSTMENT_GROUPS[i].keys
}

/** "Exposure +20, Contrast +15" — at most three, then a count. */
function sliderSummary(a: Adjustments, keys: (keyof Adjustments)[]): string[] {
  const touched = keys.filter((k) => a[k] !== 0)
  const shown = touched.slice(0, 3).map((k) => `${adjustmentLabel(k)} ${a[k] > 0 ? '+' : ''}${a[k]}`)
  if (touched.length > shown.length) shown.push(`+${touched.length - shown.length} more`)
  return shown
}

const curveChannels = (c: ToneCurve) =>
  (['rgb', 'r', 'g', 'b'] as (keyof ToneCurve)[]).filter((ch) => !isIdentityCurve({
    ...defaultToneCurve(), [ch]: c[ch],
  }))

/**
 * Whether a section holds anything but defaults, and a one-line description of
 * what. Drives both the header dot and the collapsed summary, so the panel can
 * be scanned without opening anything.
 */
export function sectionStatus(id: SectionId, state: EditState): { modified: boolean; summary: string } {
  const parts: string[] = []

  switch (id) {
    case 'presets':
      if (state.filter.id !== 'original') {
        parts.push(`${state.filter.id}${state.filter.intensity < 1 ? ` ${Math.round(state.filter.intensity * 100)}%` : ''}`)
      }
      break
    case 'light':
    case 'presence':
    case 'effects':
      parts.push(...sliderSummary(state.adjustments, groupKeys(id)))
      break
    case 'color':
      parts.push(...sliderSummary(state.adjustments, groupKeys('color')))
      if (!isIdentityMixer(state.hsl)) {
        const bands = HUE_BANDS.filter((b) => state.hsl[b].hue || state.hsl[b].sat || state.hsl[b].lum)
        parts.push(`Mixer (${bands.length})`)
      }
      if (!isNeutralWheels(state.wheels)) parts.push('Grading')
      break
    case 'curve': {
      const ch = curveChannels(state.curve)
      if (ch.length) parts.push(ch.map((c) => c.toUpperCase()).join(', '))
      break
    }
    case 'crop':
      if (state.crop) parts.push(`${Math.round(state.crop.w * 100)}×${Math.round(state.crop.h * 100)}%`)
      if (state.rotate) parts.push(`${state.rotate}°`)
      if (state.straighten) parts.push(`${state.straighten > 0 ? '+' : ''}${state.straighten}° tilt`)
      if (state.flipH) parts.push('flip H')
      if (state.flipV) parts.push('flip V')
      break
    case 'masks': {
      const active = state.masks.length
      if (active) parts.push(`${active} mask${active === 1 ? '' : 's'}`)
      break
    }
    case 'slice':
      if (state.slice) parts.push('cut applied')
      break
  }

  return { modified: parts.length > 0, summary: parts.join(', ') }
}

/** Return `state` with just this section back at its defaults. */
export function clearSection(id: SectionId, state: EditState): EditState {
  const zeroKeys = (keys: (keyof Adjustments)[]) => {
    const adjustments = { ...state.adjustments }
    for (const k of keys) adjustments[k] = ZERO_ADJUSTMENTS[k]
    return adjustments
  }

  switch (id) {
    case 'presets':
      return { ...state, filter: { id: 'original', intensity: 1 } }
    case 'light':
    case 'presence':
    case 'effects':
      return { ...state, adjustments: zeroKeys(groupKeys(id)) }
    case 'color':
      return {
        ...state,
        adjustments: zeroKeys(groupKeys('color')),
        hsl: defaultHslMixer(),
        wheels: defaultColorWheels(),
      }
    case 'curve':
      return { ...state, curve: defaultToneCurve() }
    case 'crop':
      return { ...state, crop: null, rotate: 0, straighten: 0, flipH: false, flipV: false }
    case 'masks':
      return { ...state, masks: [] }
    case 'slice':
      return { ...state, slice: null }
  }
}
