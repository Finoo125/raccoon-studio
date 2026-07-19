'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload, Loader2, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { startGalleryLoad } from '@/lib/photo-edit/deep-link'
import { useGalleryStore } from '@/lib/gallery/store'
import { useFileDrop } from '@/lib/generation/useFileDrop'
import GalleryFolderSidebar from '@/components/gallery/GalleryFolderSidebar'
import GalleryGrid from '@/components/gallery/GalleryGrid'
import type { GalleryImage } from '@/types/gallery'

interface GalleryResponse {
  images: GalleryImage[]
  scannedAt: string
  imagesDir: string
}

/**
 * Photo-editing image chooser. Reuses the main Gallery's folder sidebar and
 * windowed grid (via the shared `useGalleryStore`) so images are easy to find,
 * plus an upload / drag-and-drop zone for bringing in external files. Picking a
 * tile loads it straight into the editor instead of opening the inspector.
 */
export default function ImagePicker() {
  const loadSource = usePhotoEditStore((s) => s.loadSource)
  const source = usePhotoEditStore((s) => s.source)
  const setPickerOpen = usePhotoEditStore((s) => s.setPickerOpen)
  const { setImages, setLoading, setScanMeta, setMediaMode } = useGalleryStore()
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load the image gallery into the shared store on mount (images only).
  useEffect(() => {
    setMediaMode('image')
    setLoading(true)
    fetch('/api/gallery?media=image&sort=newest', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Gallery load failed: ${res.status}`)
        const data = (await res.json()) as GalleryResponse
        setImages(data.images)
        setScanMeta(data.imagesDir, data.scannedAt)
      })
      .catch((err: unknown) => {
        console.error('[ImagePicker] Failed to load gallery:', err)
        toast.error('Failed to load gallery')
      })
      .finally(() => setLoading(false))
  }, [setImages, setLoading, setScanMeta, setMediaMode])

  const handlePick = useCallback(
    (img: GalleryImage) => {
      startGalleryLoad(
        { subfolder: img.subfolder, filename: img.filename },
        {
          fetchImage: async (url) => {
            const res = await fetch(url)
            if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
            return res.blob()
          },
          createBitmap: (blob) => createImageBitmap(blob),
          loadSource,
          onError: (err) => {
            console.error('[ImagePicker] Failed to load gallery image:', err)
            toast.error('Failed to load image')
          },
        },
      )
    },
    [loadSource],
  )

  const handleFile = useCallback(
    async (file: File) => {
      setUploading(true)
      try {
        const bmp = await createImageBitmap(file)
        loadSource(bmp, { kind: 'upload', filename: file.name })
      } catch (err: unknown) {
        console.error('[ImagePicker] Failed to load uploaded file:', err)
        toast.error('Failed to load image')
      } finally {
        setUploading(false)
      }
    },
    [loadSource],
  )

  const { isDragging, dragProps } = useFileDrop(
    (file) => void handleFile(file),
    'image/*',
  )

  return (
    <div className="flex h-full overflow-hidden">
      {/* Folder sidebar (shared with the main Gallery) */}
      <GalleryFolderSidebar />

      {/* Upload zone + grid */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Back to editor — only when swapping a loaded image */}
        {source && (
          <div className="flex shrink-0 items-center border-b border-border px-4 py-2">
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to editor
            </button>
            <span className="ml-3 text-xs text-muted-foreground">Pick an image to swap the canvas</span>
          </div>
        )}

        {/* Upload zone */}
        <div className="shrink-0 border-b border-border p-4" {...dragProps}>
          <div
            className={cn(
              'flex items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-card/40 px-6 py-5 transition-colors',
              isDragging ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'border-border',
            )}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            </div>
            <p className="text-sm text-foreground">
              Drop an image here, or{' '}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="text-primary underline-offset-2 hover:underline disabled:opacity-60"
              >
                browse
              </button>
              <span className="ml-2 text-xs text-muted-foreground">PNG, JPG, WebP</span>
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleFile(f)
              }}
            />
          </div>
        </div>

        {/* Gallery grid — clicking a tile loads it into the editor */}
        <div className="min-h-0 flex-1">
          <GalleryGrid onPick={handlePick} />
        </div>
      </div>
    </div>
  )
}
