import { ADJUSTMENT_KEYS, type Adjustments, type Preset } from './types'

export const PRESETS: Preset[] = [
  { id: 'original', name: 'Original', adjustments: {} },
  { id: 'chrome', name: 'Chrome', adjustments: { contrast: 18, saturation: 14, clarity: 10 } },
  { id: 'mono', name: 'Mono', adjustments: { saturation: -100, contrast: 12 } },
  { id: 'noir', name: 'Noir', adjustments: { saturation: -100, contrast: 38, shadows: -25, clarity: 18 } },
  { id: 'fade', name: 'Fade', adjustments: { contrast: -18, shadows: 22, saturation: -10, exposure: 6 } },
  { id: 'instant', name: 'Instant', adjustments: { warmth: -12, tint: 10, contrast: 10, saturation: 8 } },
  { id: 'process', name: 'Process', adjustments: { warmth: 20, saturation: 16, contrast: 14 } },
  { id: 'vivid', name: 'Vivid', adjustments: { saturation: 28, contrast: 16, vibrance: 20 } },
  { id: 'dramatic', name: 'Dramatic', adjustments: { contrast: 34, clarity: 28, shadows: -18, highlights: -10 } },
  { id: 'silvertone', name: 'Silvertone', adjustments: { saturation: -100, contrast: 20, warmth: 6 } },
  { id: 'teal-orange', name: 'Teal & Orange', adjustments: { contrast: 12, saturation: 8 },
    grade: { shadow: [10, 90, 110], highlight: [255, 150, 60], balance: 0 } },
  { id: 'sunset', name: 'Sunset', adjustments: { warmth: 10, saturation: 10 },
    grade: { shadow: [80, 40, 70], highlight: [255, 170, 90], balance: 5 } },
  { id: 'cold-blue', name: 'Cold Blue', adjustments: { contrast: 10, saturation: -6 },
    grade: { shadow: [20, 40, 80], highlight: [170, 200, 255], balance: 0 } },
  { id: 'sepia', name: 'Sepia', adjustments: { saturation: -100, contrast: 8 },
    grade: { shadow: [60, 38, 20], highlight: [240, 210, 165], balance: 0 } },
  { id: 'vintage-film', name: 'Vintage Film', adjustments: { contrast: -14, shadows: 18, saturation: -8 },
    grade: { shadow: [55, 60, 45], highlight: [235, 220, 180], balance: 8 } },
  { id: 'faded-retro', name: 'Faded Retro', adjustments: { contrast: -18, exposure: 6 },
    grade: { shadow: [70, 55, 75], highlight: [220, 230, 170], balance: 0 } },
]

// Layer the preset's bundle onto the user's base adjustments, scaled by intensity.
export function applyPreset(base: Adjustments, preset: Preset, intensity: number): Adjustments {
  const out = { ...base }
  for (const k of ADJUSTMENT_KEYS) {
    const delta = preset.adjustments[k] ?? 0
    out[k] = base[k] + delta * intensity
  }
  return out
}
