import type { GalleryImage } from '@/types/gallery'

export interface GalleryFolder {
  /** Stable grouping key — the on-disk date-folder name (e.g. "2026-06-12"). */
  key: string
  /** Human-friendly label for display (friendly date, or the raw key). */
  label: string
  /** Number of images in this folder (within the current filter scope). */
  count: number
  /** Thumbnail of the newest item in the folder, used as the folder cover. */
  coverUrl: string
  /** Whether the cover is a video (render with <video>, not <img>). */
  coverIsVideo: boolean
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The date-folder a gallery image belongs to. Images are stored under
 * `images/<preset>/<date>/`, so the date is the segment after the preset. When
 * that segment is missing we fall back to the image's createdAt day so every
 * image still lands in some folder.
 */
export function dateKeyOf(img: GalleryImage): string {
  const parts = img.subfolder.split('/').filter(Boolean)
  const last = parts[parts.length - 1]
  // A bare `images/<preset>` has only two segments — no date folder.
  if (parts.length >= 3 && last) return last
  return img.createdAt.slice(0, 10)
}

/** Friendly label for a date key; non-date keys are shown verbatim. */
function labelFor(key: string): string {
  if (!DATE_KEY_RE.test(key)) return key
  const d = new Date(`${key}T00:00:00`)
  if (Number.isNaN(d.getTime())) return key
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * Group an (already filtered) image list into date folders, newest-first. The
 * cover is the newest image in each folder. Operating on the filtered list
 * means preset/favorites/search naturally re-scope the folder counts and hide
 * empty dates.
 */
export function buildFolders(images: GalleryImage[]): GalleryFolder[] {
  const groups = new Map<string, { count: number; cover: GalleryImage }>()

  for (const img of images) {
    const key = dateKeyOf(img)
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, { count: 1, cover: img })
    } else {
      existing.count += 1
      if (img.createdAt > existing.cover.createdAt) existing.cover = img
    }
  }

  return Array.from(groups.entries())
    .map(([key, { count, cover }]) => ({
      key,
      label: labelFor(key),
      count,
      coverUrl: cover.thumbnailUrl,
      coverIsVideo: cover.media === 'video',
    }))
    .sort((a, b) => b.key.localeCompare(a.key))
}
