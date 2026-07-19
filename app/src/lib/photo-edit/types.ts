export interface ImageLike { data: Uint8ClampedArray; width: number; height: number }

export interface Adjustments {
  exposure: number; brightness: number; contrast: number
  highlights: number; shadows: number
  saturation: number; vibrance: number
  warmth: number; tint: number
  sharpness: number; clarity: number; vignette: number
}

/** Split-tone color grade: tint pulled into shadows vs highlights by luminance. */
export interface ColorGrade {
  shadow: [number, number, number]     // 0..255 RGB tint for dark areas
  highlight: [number, number, number]  // 0..255 RGB tint for bright areas
  balance: number                      // -100..100, shifts the shadow/highlight midpoint
}

export interface FilterState { id: string; intensity: number }
export interface Crop { x: number; y: number; w: number; h: number } // normalized 0..1

/** Straight cut: line A→B in normalized display coords; `keep` is which half-plane survives.
 *  Side test sign(cross) where cross = (bx-ax)*(py-ay) - (by-ay)*(px-ax).
 *  keep 'a' keeps cross >= 0; keep 'b' keeps cross < 0. */
export interface Slice { ax: number; ay: number; bx: number; by: number; keep: 'a' | 'b' }

export interface EditState {
  adjustments: Adjustments
  filter: FilterState
  crop: Crop | null
  straighten: number          // degrees
  rotate: 0 | 90 | 180 | 270
  flipH: boolean
  flipV: boolean
  slice: Slice | null
}

export const ZERO_ADJUSTMENTS: Adjustments = {
  exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0,
  saturation: 0, vibrance: 0, warmth: 0, tint: 0, sharpness: 0, clarity: 0, vignette: 0,
}

export const ADJUSTMENT_KEYS = Object.keys(ZERO_ADJUSTMENTS) as (keyof Adjustments)[]

export interface Preset { id: string; name: string; adjustments: Partial<Adjustments>; grade?: ColorGrade }

export function defaultEditState(): EditState {
  return {
    adjustments: { ...ZERO_ADJUSTMENTS },
    filter: { id: 'original', intensity: 1 },
    crop: null, straighten: 0, rotate: 0, flipH: false, flipV: false,
    slice: null,
  }
}
