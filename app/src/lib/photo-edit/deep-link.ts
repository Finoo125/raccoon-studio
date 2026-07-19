import type { Origin } from './store'

/** The gallery image a deep link asks the editor to open. */
export interface GalleryRequest {
  subfolder: string
  filename: string
}

/** True when the editor already holds exactly this gallery image. */
export function galleryOriginMatches(origin: Origin | null, req: GalleryRequest): boolean {
  return (
    origin?.kind === 'gallery' &&
    origin.subfolder === req.subfolder &&
    origin.filename === req.filename
  )
}

export interface GalleryLoadDeps {
  /** Fetch the raw image bytes for the given gallery URL. */
  fetchImage: (url: string) => Promise<Blob>
  /** Decode the bytes into a bitmap. */
  createBitmap: (blob: Blob) => Promise<ImageBitmap>
  /** Commit the decoded image to the editor. */
  loadSource: (bmp: ImageBitmap, origin: Origin) => void
  /** Optional error sink (the component shows a toast). */
  onError?: (err: unknown) => void
}

/**
 * Start loading a gallery image into the editor.
 *
 * Returns a `cancel` function for effect cleanup. Each call owns an independent
 * cancellation flag, so React's dev double-mount (start → cancel → start) is
 * safe: the cancelled first run discards its bitmap, and the second run
 * completes the load. There is no persistent guard that could permanently block
 * a re-load.
 */
export function startGalleryLoad(req: GalleryRequest, deps: GalleryLoadDeps): () => void {
  let cancelled = false
  const url = `/api/gallery/image?subfolder=${encodeURIComponent(req.subfolder)}&filename=${encodeURIComponent(req.filename)}`

  void (async () => {
    try {
      const blob = await deps.fetchImage(url)
      const bmp = await deps.createBitmap(blob)
      if (cancelled) {
        bmp.close()
        return
      }
      deps.loadSource(bmp, { kind: 'gallery', subfolder: req.subfolder, filename: req.filename })
    } catch (err: unknown) {
      if (!cancelled) deps.onError?.(err)
    }
  })()

  return () => {
    cancelled = true
  }
}
