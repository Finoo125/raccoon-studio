import fs from 'fs'
import path from 'path'
import type { GalleryImage } from '@/types/gallery'
import { parsePngTextChunks, extractMetadataFromPromptChunk, extractMetadataFromParameters } from './metadata'
import { log } from '@/lib/logging/logger'

const OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR ?? ''
/** Where per-image sidecars (favorite + tags) live. Env-overridable for tests. */
export function getSidecarDir(): string {
  return process.env.RACCOON_SIDECAR_DIR ?? path.join(process.cwd(), '.gallery-sidecars')
}
/**
 * Env-overridable like the sidecar dir above: the cache is keyed on cwd, so a
 * second server started against this checkout with a different
 * COMFYUI_OUTPUT_DIR would otherwise be served the first one's scan.
 */
const CACHE_FILE =
  process.env.RACCOON_GALLERY_CACHE ?? path.join(process.cwd(), '.gallery-cache.json')
// How long a persisted scan is considered fresh before an automatic rescan.
const CACHE_TTL_MS = 10 * 60 * 1000

export function getImagesDir(): string {
  return path.join(OUTPUT_DIR, 'images')
}

export function getVideoDir(): string {
  return path.join(OUTPUT_DIR, 'video')
}

const VIDEO_RE = /\.(mp4|webm|mov|mkv|m4v)$/i

// Auto-discover every workflow folder under output/images/ (e.g. ZIT, Anima,
// ERNIE). This avoids a hardcoded list that breaks on renames or new models.
function discoverWorkflowFolders(imagesBase: string): string[] {
  try {
    return fs
      .readdirSync(imagesBase)
      .filter((d) => {
        try {
          return fs.statSync(path.join(imagesBase, d)).isDirectory()
        } catch {
          return false
        }
      })
  } catch {
    return []
  }
}

function getSidecarPath(imageId: string): string {
  const dir = getSidecarDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${imageId}.json`)
}

export function readFavorite(imageId: string): boolean {
  try {
    const p = getSidecarPath(imageId)
    if (!fs.existsSync(p)) return false
    const data = JSON.parse(fs.readFileSync(p, 'utf8')) as { favorite?: boolean }
    return data.favorite === true
  } catch {
    return false
  }
}

export function writeFavorite(imageId: string, value: boolean): void {
  const p = getSidecarPath(imageId)
  let data: Record<string, unknown> = {}
  try {
    if (fs.existsSync(p)) data = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>
  } catch { /* fresh file */ }
  data.favorite = value
  fs.writeFileSync(p, JSON.stringify(data))
}

/** All sidecars in one directory pass: favorite flag + tags per image id. */
export function readAllSidecars(): Map<string, { favorite: boolean; tags: string[] }> {
  const map = new Map<string, { favorite: boolean; tags: string[] }>()
  const dir = getSidecarDir()
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as {
          favorite?: boolean; tags?: string[]
        }
        map.set(f.slice(0, -'.json'.length), {
          favorite: data.favorite === true,
          tags: Array.isArray(data.tags) ? data.tags : [],
        })
      } catch { /* skip unreadable sidecar */ }
    }
  } catch { /* no sidecar dir yet */ }
  return map
}

/** Persists tags, preserving any existing favorite flag. */
export function writeTags(imageId: string, tags: string[]): void {
  const p = getSidecarPath(imageId)
  let data: Record<string, unknown> = {}
  try {
    if (fs.existsSync(p)) data = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>
  } catch { /* fresh file */ }
  data.tags = tags
  fs.writeFileSync(p, JSON.stringify(data))
}

export function imageId(subfolder: string, filename: string): string {
  return Buffer.from(`${subfolder}/${filename}`).toString('base64url')
}

/** Inverse of imageId: decodes the base64url id back to subfolder + filename. */
export function decodeImageId(id: string): { subfolder: string; filename: string } | null {
  try {
    const decoded = Buffer.from(id, 'base64url').toString('utf8')
    const slash = decoded.lastIndexOf('/')
    if (slash <= 0 || slash === decoded.length - 1) return null
    const subfolder = decoded.slice(0, slash)
    const filename = decoded.slice(slash + 1)
    // Reject anything that doesn't re-encode to the same id (garbage input).
    if (imageId(subfolder, filename) !== id) return null
    return { subfolder, filename }
  } catch {
    return null
  }
}

// PNG text chunks (ComfyUI prompt/workflow, A1111 parameters) sit before the
// IDAT pixel data, so reading a 1 MB header prefix captures them without
// loading multi-MB pixel data per image.
const HEADER_BYTES = 1024 * 1024

function readHeaderPrefix(filePath: string): Buffer {
  const fd = fs.openSync(filePath, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const len = Math.min(HEADER_BYTES, size)
    const buf = Buffer.allocUnsafe(len)
    fs.readSync(fd, buf, 0, len, 0)
    return buf
  } finally {
    fs.closeSync(fd)
  }
}

function extractMetadataFromFile(filePath: string) {
  try {
    const buf = readHeaderPrefix(filePath)
    const chunks = parsePngTextChunks(buf)
    // ComfyUI embeds a `prompt` JSON; sd-webui/Forge tools embed a flat
    // `parameters` text block. Support both so metadata is extracted either way.
    if (chunks.prompt) return extractMetadataFromPromptChunk(chunks.prompt)
    if (chunks.parameters) return extractMetadataFromParameters(chunks.parameters)
  } catch { /* non-readable or non-png */ }
  return {}
}

export interface ScanOptions {
  /** Restrict to images or videos. Omitted = both. Legacy items (no `media`) count as image. */
  media?: 'image' | 'video'
  workflow?: string
  search?: string
  favoritesOnly?: boolean
  dateFrom?: string // YYYY-MM-DD inclusive
  dateTo?: string   // YYYY-MM-DD inclusive
  sortBy?: 'newest' | 'oldest' | 'name' | 'largest' | 'random'
  tag?: string
  model?: string
  sampler?: string
  dimensions?: string // "WxH"
}

// ---------------------------------------------------------------------------
// Raw filesystem scan. Incremental: a file whose mtime matches the previous
// scan reuses its cached metadata, so only new/changed files are read from
// disk. With immutable ComfyUI outputs a rescan becomes a directory diff.
// ---------------------------------------------------------------------------
function scanRaw(prev: GalleryImage[] = []): GalleryImage[] {
  const imagesBase = getImagesDir()
  if (!fs.existsSync(imagesBase)) return []

  const prevById = new Map(prev.map((p) => [p.id, p]))
  const sidecars = readAllSidecars()
  const results: GalleryImage[] = []

  for (const wf of discoverWorkflowFolders(imagesBase)) {
    const wfDir = path.join(imagesBase, wf)

    const dateFolders = fs.readdirSync(wfDir).filter((d) => {
      try {
        return fs.statSync(path.join(wfDir, d)).isDirectory()
      } catch {
        return false
      }
    })

    for (const dateFolder of dateFolders) {
      const dateDir = path.join(wfDir, dateFolder)
      let files: string[]
      try {
        files = fs.readdirSync(dateDir).filter((f) => f.match(/\.(png|jpg|jpeg|webp)$/i))
      } catch {
        continue
      }

      for (const filename of files) {
        const filePath = path.join(dateDir, filename)
        const subfolder = `images/${wf}/${dateFolder}`
        const id = imageId(subfolder, filename)
        let stat: fs.Stats
        try {
          stat = fs.statSync(filePath)
        } catch {
          continue
        }

        // Reuse metadata from the previous scan when the file is unchanged;
        // only read pixels-free header metadata for new/modified files.
        const cached = prevById.get(id)
        const reuse = cached && cached.mtimeMs === stat.mtimeMs
        const metadata = reuse ? cached.metadata : { ...extractMetadataFromFile(filePath), workflow: wf }

        const viewUrl = `/api/gallery/image?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}`

        results.push({
          id,
          filename,
          subfolder,
          dir: dateDir,
          url: viewUrl,
          thumbnailUrl: viewUrl,
          createdAt: stat.mtime.toISOString(),
          mtimeMs: stat.mtimeMs,
          metadata,
          favorite: sidecars.get(id)?.favorite ?? false,
          tags: sidecars.get(id)?.tags ?? [],
          width: metadata.width,
          height: metadata.height,
        })
      }
    }
  }

  results.push(...scanVideosRaw(sidecars))
  return results
}

// ---------------------------------------------------------------------------
// Videos live under output/video/<preset>/<date>/ (e.g. video/LTX23/2026-06-13).
// They carry no PNG metadata, so we record just the preset (as `workflow`) and
// file times — enough for date-folder grouping and the inspector. Served through
// the Range-capable /api/gallery/video route so playback can seek.
// ---------------------------------------------------------------------------
function scanVideosRaw(sidecars: Map<string, { favorite: boolean; tags: string[] }>): GalleryImage[] {
  const videoBase = getVideoDir()
  if (!fs.existsSync(videoBase)) return []

  const out: GalleryImage[] = []
  for (const preset of discoverWorkflowFolders(videoBase)) {
    const presetDir = path.join(videoBase, preset)
    let dateFolders: string[]
    try {
      dateFolders = fs.readdirSync(presetDir).filter((d) => {
        try { return fs.statSync(path.join(presetDir, d)).isDirectory() } catch { return false }
      })
    } catch {
      continue
    }

    for (const dateFolder of dateFolders) {
      const dateDir = path.join(presetDir, dateFolder)
      let files: string[]
      try {
        files = fs.readdirSync(dateDir).filter((f) => VIDEO_RE.test(f))
      } catch {
        continue
      }

      for (const filename of files) {
        const filePath = path.join(dateDir, filename)
        const subfolder = `video/${preset}/${dateFolder}`
        const id = imageId(subfolder, filename)
        let stat: fs.Stats
        try {
          stat = fs.statSync(filePath)
        } catch {
          continue
        }

        const viewUrl = `/api/gallery/video?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}`
        out.push({
          id,
          media: 'video',
          filename,
          subfolder,
          dir: dateDir,
          url: viewUrl,
          thumbnailUrl: viewUrl,
          createdAt: stat.mtime.toISOString(),
          mtimeMs: stat.mtimeMs,
          metadata: { workflow: preset },
          favorite: sidecars.get(id)?.favorite ?? false,
          tags: sidecars.get(id)?.tags ?? [],
        })
      }
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// Persisted cache so the gallery loads instantly and works while ComfyUI is
// offline. A fresh scan happens on demand (refresh) or when the cache is stale.
// ---------------------------------------------------------------------------
interface GalleryCache {
  scannedAt: string
  images: GalleryImage[]
}

function readCache(): GalleryCache | null {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as GalleryCache
  } catch {
    return null
  }
}

function writeCache(cache: GalleryCache): void {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache))
  } catch { /* non-fatal */ }
}

export interface GalleryResult {
  images: GalleryImage[]
  scannedAt: string
  imagesDir: string
  cached: boolean
}

/**
 * Returns the raw image list, scanning the filesystem when forced or when the
 * persisted cache is missing/stale. Favorite flags are always re-read from the
 * sidecars so toggles survive a cache hit.
 */
export function getGalleryRaw(refresh = false): GalleryResult {
  const cache = readCache()
  const fresh = cache && Date.now() - new Date(cache.scannedAt).getTime() < CACHE_TTL_MS

  if (!refresh && fresh && cache) {
    const sidecars = readAllSidecars()
    const images = cache.images.map((img) => ({
      ...img,
      favorite: sidecars.get(img.id)?.favorite ?? false,
      tags: sidecars.get(img.id)?.tags ?? [],
    }))
    return { images, scannedAt: cache.scannedAt, imagesDir: getImagesDir(), cached: true }
  }

  const started = Date.now()
  const images = scanRaw(cache?.images ?? [])
  const scannedAt = new Date().toISOString()
  writeCache({ scannedAt, images })
  log('info', 'gallery', `Scanned ${images.length} images in ${Date.now() - started}ms`)
  return { images, scannedAt, imagesDir: getImagesDir(), cached: false }
}

// ---------------------------------------------------------------------------
// Filter + sort (cheap — runs on the cached list every request)
// ---------------------------------------------------------------------------
export function applyFilters(images: GalleryImage[], opts: ScanOptions): GalleryImage[] {
  let filtered = images

  if (opts.media) filtered = filtered.filter((i) => (i.media ?? 'image') === opts.media)
  if (opts.workflow) filtered = filtered.filter((i) => i.metadata.workflow === opts.workflow)
  if (opts.favoritesOnly) filtered = filtered.filter((i) => i.favorite)
  if (opts.tag) filtered = filtered.filter((i) => i.tags?.includes(opts.tag!))
  if (opts.model) filtered = filtered.filter((i) => i.metadata.model === opts.model)
  if (opts.sampler) filtered = filtered.filter((i) => i.metadata.sampler === opts.sampler)
  if (opts.dimensions) filtered = filtered.filter((i) => `${i.metadata.width}x${i.metadata.height}` === opts.dimensions)

  if (opts.dateFrom || opts.dateTo) {
    filtered = filtered.filter((i) => {
      const day = i.createdAt.slice(0, 10)
      if (opts.dateFrom && day < opts.dateFrom) return false
      if (opts.dateTo && day > opts.dateTo) return false
      return true
    })
  }

  if (opts.search) {
    const q = opts.search.toLowerCase()
    filtered = filtered.filter((i) => {
      const m = i.metadata
      return (
        m.prompt?.toLowerCase().includes(q) ||
        m.model?.toLowerCase().includes(q) ||
        String(m.seed).includes(q) ||
        i.filename.toLowerCase().includes(q) ||
        m.workflow?.toLowerCase().includes(q)
      )
    })
  }

  // Copy before sorting so we never mutate the cached array in place.
  const sort = opts.sortBy ?? 'newest'
  const out = [...filtered]
  if (sort === 'newest') out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  else if (sort === 'oldest') out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  else if (sort === 'name') out.sort((a, b) => a.filename.localeCompare(b.filename))
  else if (sort === 'random') out.sort(() => Math.random() - 0.5)

  return out
}

/** Convenience: scan (cache-aware) + filter in one call. */
export function scanGallery(opts: ScanOptions = {}, refresh = false): GalleryImage[] {
  return applyFilters(getGalleryRaw(refresh).images, opts)
}
