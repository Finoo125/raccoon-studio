import type { Crop } from './types'

export function orientedSize(w: number, h: number, rotate: number) {
  return rotate === 90 || rotate === 270 ? { width: h, height: w } : { width: w, height: h }
}

export function cropToPixels(c: Crop, w: number, h: number) {
  return { x: Math.round(c.x * w), y: Math.round(c.y * h), w: Math.round(c.w * w), h: Math.round(c.h * h) }
}

export function normalizeCrop(px: { x: number; y: number; w: number; h: number }, w: number, h: number): Crop {
  return { x: px.x / w, y: px.y / h, w: px.w / w, h: px.h / h }
}

export const ASPECT_RATIOS = [
  { id: 'original', label: 'Original', value: null as number | null },
  { id: '1:1', label: '1:1', value: 1 },
  { id: '4:3', label: '4:3', value: 4 / 3 },
  { id: '3:2', label: '3:2', value: 3 / 2 },
  { id: '16:9', label: '16:9', value: 16 / 9 },
  { id: '9:16', label: '9:16', value: 9 / 16 },
]
