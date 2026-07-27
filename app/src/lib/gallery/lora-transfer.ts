import type { ImageMetadata } from '@/types/gallery'
import type { LoraParam } from '@/types/workflow'

export function serializeGalleryLoras(loras: ImageMetadata['loras']): string | null {
  return loras?.length ? JSON.stringify(loras) : null
}

export function parseGalleryLoras(value: string | null): LoraParam[] | undefined {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return undefined
    const loras = parsed.flatMap((item): LoraParam[] => {
      if (!item || typeof item !== 'object') return []
      const { name, strength } = item as { name?: unknown; strength?: unknown }
      if (typeof name !== 'string' || !name) return []
      if (strength === undefined) return [{ name }]
      return typeof strength === 'number' && Number.isFinite(strength)
        ? [{ name, strength }]
        : []
    })
    return loras.length ? loras : undefined
  } catch {
    return undefined
  }
}
