export interface ImageLike { data: Uint8ClampedArray; width: number; height: number }

/**
 * Unique id for a mask or a saved preset.
 *
 * The random tail is load-bearing: a bare timestamp collides whenever two are
 * created inside the same millisecond, and two entries sharing an id means
 * deleting one deletes both.
 */
export function editorId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export interface Adjustments {
  // Light
  exposure: number; contrast: number
  highlights: number; shadows: number; whites: number; blacks: number
  // Color
  warmth: number; tint: number; vibrance: number; saturation: number
  // Presence
  texture: number; clarity: number; dehaze: number
  // Effects
  sharpness: number; vignette: number; grain: number
}

/** Split-tone color grade: tint pulled into shadows vs highlights by luminance. */
export interface ColorGrade {
  shadow: [number, number, number]     // 0..255 RGB tint for dark areas
  highlight: [number, number, number]  // 0..255 RGB tint for bright areas
  /** Optional midtone tint. Absent = the midpoint of shadow/highlight, which is
   *  exactly what a straight shadow→highlight lerp already produced. */
  midtone?: [number, number, number]
  balance: number                      // -100..100, shifts the shadow/highlight midpoint
}

/** One grading wheel: a hue/saturation puck plus a luminance offset for its zone. */
export interface WheelStop { hue: number; sat: number; lum: number }

export interface ColorWheels {
  shadows: WheelStop
  midtones: WheelStop
  highlights: WheelStop
  /** Overall strength of the grade, 0..100. */
  blending: number
  /** Slides the shadow/highlight split, -100..100. */
  balance: number
}

export function defaultColorWheels(): ColorWheels {
  const neutral = (): WheelStop => ({ hue: 0, sat: 0, lum: 0 })
  return { shadows: neutral(), midtones: neutral(), highlights: neutral(), blending: 100, balance: 0 }
}

/** A tone-curve control point in 0..255 input/output space. */
export interface CurvePoint { x: number; y: number }

/** Point curves: a master applied to all channels, plus one per channel. */
export interface ToneCurve { rgb: CurvePoint[]; r: CurvePoint[]; g: CurvePoint[]; b: CurvePoint[] }

export const IDENTITY_CURVE: CurvePoint[] = [{ x: 0, y: 0 }, { x: 255, y: 255 }]

export function defaultToneCurve(): ToneCurve {
  return {
    rgb: [...IDENTITY_CURVE], r: [...IDENTITY_CURVE],
    g: [...IDENTITY_CURVE], b: [...IDENTITY_CURVE],
  }
}

/** The eight hue ranges of the colour mixer, in the order Lightroom lists them. */
export const HUE_BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const
export type HueBand = typeof HUE_BANDS[number]

/** Per-band hue shift / saturation / luminance, each -100..100. */
export interface HslBand { hue: number; sat: number; lum: number }
export type HslMixer = Record<HueBand, HslBand>

export function defaultHslMixer(): HslMixer {
  return Object.fromEntries(HUE_BANDS.map((b) => [b, { hue: 0, sat: 0, lum: 0 }])) as HslMixer
}

export interface FilterState { id: string; intensity: number }
export interface Crop { x: number; y: number; w: number; h: number } // normalized 0..1

/** Straight cut: line A→B in normalized display coords; `keep` is which half-plane survives.
 *  Side test sign(cross) where cross = (bx-ax)*(py-ay) - (by-ay)*(px-ax).
 *  keep 'a' keeps cross >= 0; keep 'b' keeps cross < 0. */
export interface Slice { ax: number; ay: number; bx: number; by: number; keep: 'a' | 'b' }

export type MaskKind = 'linear' | 'radial' | 'brush' | 'luminance'

/** A brush stroke: normalized points plus the radius they were painted at. */
export interface BrushStroke { radius: number; erase: boolean; points: { x: number; y: number }[] }

export interface Mask {
  id: string
  kind: MaskKind
  name: string
  invert: boolean
  /** Softness of the mask edge, 0..100. Meaning is per kind. */
  feather: number
  /** Linear: the gradient runs from (ax,ay) to (bx,by). Radial: centre + radii. */
  linear?: { ax: number; ay: number; bx: number; by: number }
  radial?: { cx: number; cy: number; rx: number; ry: number }
  brush?: BrushStroke[]
  /** Luminance range kept, 0..255, with `feather` softening both ends. */
  luminance?: { min: number; max: number }
  /** What this mask does where it is opaque. */
  adjustments: Adjustments
}

export interface EditState {
  adjustments: Adjustments
  curve: ToneCurve
  hsl: HslMixer
  wheels: ColorWheels
  masks: Mask[]
  filter: FilterState
  crop: Crop | null
  straighten: number          // degrees
  rotate: 0 | 90 | 180 | 270
  flipH: boolean
  flipV: boolean
  slice: Slice | null
}

export const ZERO_ADJUSTMENTS: Adjustments = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  warmth: 0, tint: 0, vibrance: 0, saturation: 0,
  texture: 0, clarity: 0, dehaze: 0,
  sharpness: 0, vignette: 0, grain: 0,
}

export const ADJUSTMENT_KEYS = Object.keys(ZERO_ADJUSTMENTS) as (keyof Adjustments)[]

/** Panel layout — the flat key list is the pipeline's order, not a useful UI order. */
export const ADJUSTMENT_GROUPS: { label: string; keys: (keyof Adjustments)[] }[] = [
  { label: 'Light', keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] },
  { label: 'Color', keys: ['warmth', 'tint', 'vibrance', 'saturation'] },
  { label: 'Presence', keys: ['texture', 'clarity', 'dehaze'] },
  { label: 'Effects', keys: ['sharpness', 'vignette', 'grain'] },
]

export interface Preset {
  id: string
  name: string
  adjustments: Partial<Adjustments>
  grade?: ColorGrade
  /** Present on user-saved presets only. */
  curve?: ToneCurve
  hsl?: HslMixer
  wheels?: ColorWheels
  custom?: boolean
}

export function defaultEditState(): EditState {
  return {
    adjustments: { ...ZERO_ADJUSTMENTS },
    curve: defaultToneCurve(),
    hsl: defaultHslMixer(),
    wheels: defaultColorWheels(),
    masks: [],
    filter: { id: 'original', intensity: 1 },
    crop: null, straighten: 0, rotate: 0, flipH: false, flipV: false,
    slice: null,
  }
}
