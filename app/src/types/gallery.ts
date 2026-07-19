export interface GalleryImage {
  id: string
  /** Image (output/images/**) or video (output/video/**). Absent = image. */
  media?: 'image' | 'video'
  filename: string
  subfolder: string
  /** Absolute path of the folder containing this image (for "open folder"). */
  dir?: string
  url: string
  thumbnailUrl: string
  width?: number
  height?: number
  createdAt: string
  /** File mtime in ms — used server-side to skip re-reading unchanged files. */
  mtimeMs?: number
  metadata: ImageMetadata
  favorite: boolean
  /** Freeform user tags (persisted in the sidecar). */
  tags?: string[]
}

export interface ImageMetadata {
  prompt?: string
  negativePrompt?: string
  model?: string
  sampler?: string
  scheduler?: string
  steps?: number
  cfg?: number
  seed?: number
  width?: number
  height?: number
  workflow?: string
  loras?: string[]
}

export type GallerySortKey = 'newest' | 'oldest' | 'name' | 'largest' | 'random'

export interface GalleryFilters {
  search: string
  workflow: string
  dateFrom: string
  dateTo: string
  favoritesOnly: boolean
  sortBy: GallerySortKey
  tag: string
  model: string
  sampler: string
  dimensions: string
}
