'use client'

import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, Images, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { buildFolders, dateKeyOf } from '@/lib/gallery/folders'
import type { GalleryImage } from '@/types/gallery'

/** Newest-first cap for "All images". A day's folder is shown whole. */
const ALL_LIMIT = 120

/**
 * "Where is the image?" — every image slot in the video form asks this before
 * it opens anything, because a picture you already rendered is the common case
 * and hunting for it in the file explorer means knowing where the app writes.
 *
 * Both answers live on one screen rather than behind a two-step choice: the
 * grid *is* the gallery option, so a second click to reach it would buy
 * nothing. `onBrowse` hands control back to the caller's own `<input
 * type=file>` — the native picker is the file explorer, and there is nothing to
 * build for that half.
 *
 * The date sidebar is the gallery's own `buildFolders`, so the dates here are
 * the dates there — including the fallback for images stored outside a
 * date-named folder.
 */
export default function PickImageDialog({
  open,
  onOpenChange,
  onPick,
  onBrowse,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** A gallery picture was chosen. */
  onPick: (image: GalleryImage) => void
  /** Fall through to the local file explorer. */
  onBrowse: () => void
}) {
  const [images, setImages] = useState<GalleryImage[] | null>(null)
  const [folder, setFolder] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      setImages(null)
      setFolder(null)
      try {
        const res = await fetch('/api/gallery?media=image')
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as { images: GalleryImage[] }
        if (!cancelled) setImages(data.images)
      } catch {
        if (!cancelled) setImages([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const all = useMemo(() => images ?? [], [images])
  const folders = useMemo(() => buildFolders(all), [all])
  // ponytail: the newest 120 for "All", a whole day for a date. Rendering
  // thousands of thumbnails at once is the only reason for the cap, and picking
  // a date is the way past it — which is what the sidebar is for.
  const shown = useMemo(
    () => (folder ? all.filter((i) => dateKeyOf(i) === folder) : all.slice(0, ALL_LIMIT)),
    [all, folder],
  )

  const rowClass = (active: boolean) =>
    `flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ${
      active
        ? 'bg-primary/10 text-foreground ring-1 ring-primary/30'
        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
    }`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Choose an image</DialogTitle>
          <DialogDescription>Pick one from your gallery, or browse your own files.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Button variant="outline" className="h-10 w-full justify-start gap-2" onClick={onBrowse}>
            <FolderOpen className="h-4 w-4" /> Browse on my Computer
          </Button>
          <div className="flex max-h-[52vh] gap-2 rounded-lg border border-border bg-muted/10 p-2">
            {/* Date sidebar — same grouping as the gallery's own folder rail. */}
            <aside className="w-44 shrink-0 space-y-0.5 overflow-y-auto border-r border-border pr-2">
              <h3 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Folders
              </h3>
              <button type="button" onClick={() => setFolder(null)} className={rowClass(folder === null)}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted ring-1 ring-border">
                  <Images className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">All images</span>
                <span className="shrink-0 text-[11px] tabular-nums">{all.length}</span>
              </button>
              {folders.map((f) => (
                <button key={f.key} type="button" onClick={() => setFolder(f.key)} className={rowClass(folder === f.key)}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- gallery thumbnail route */}
                  <img src={f.coverUrl} alt="" className="h-8 w-8 shrink-0 rounded-md bg-muted object-cover ring-1 ring-border" />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{f.label}</span>
                  <span className="shrink-0 text-[11px] tabular-nums">{f.count}</span>
                </button>
              ))}
            </aside>

            <div className="min-w-0 flex-1 overflow-y-auto">
              {images === null ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : shown.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Nothing here yet — browse your computer instead.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {shown.map((img) => (
                      <button
                        key={img.id}
                        type="button"
                        onClick={() => onPick(img)}
                        title={img.filename}
                        className="group relative aspect-square overflow-hidden rounded-lg ring-1 ring-border transition-all hover:ring-2 hover:ring-primary"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- gallery thumbnail route */}
                        <img
                          src={img.thumbnailUrl}
                          alt={img.filename}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                        />
                      </button>
                    ))}
                  </div>
                  {!folder && all.length > ALL_LIMIT && (
                    <p className="pt-2 text-center text-[11px] text-muted-foreground">
                      Newest {ALL_LIMIT} of {all.length} — pick a date on the left for the rest.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Wire an existing "upload a picture" button to the picker, without moving the
 * component's own `<input type=file>` or its `handleFile`.
 *
 * Every uploader in the app was the same three parts — a hidden file input, a
 * button that clicks it, and a `handleFile(file)`. Rather than paste the dialog
 * into each one, this hook takes the ref and the handler and hands back the
 * button's new `onClick` plus the element to render. A gallery pick is turned
 * into a `File` so it arrives at `handleFile` looking exactly like a browsed
 * one: the upload, any preview and any decode stay written once, in the caller.
 */
export function useImagePicker(
  inputRef: React.RefObject<HTMLInputElement | null>,
  onFile: (file: File) => void,
) {
  const [open, setOpen] = useState(false)

  const pickerDialog = (
    <PickImageDialog
      open={open}
      onOpenChange={setOpen}
      onBrowse={() => {
        setOpen(false)
        inputRef.current?.click()
      }}
      onPick={(img) => {
        setOpen(false)
        void (async () => {
          try {
            const res = await fetch(img.url)
            if (!res.ok) throw new Error(`Could not load image (${res.status})`)
            const blob = await res.blob()
            onFile(new File([blob], img.filename, { type: blob.type }))
          } catch (e) {
            toast.error(`Could not use that image: ${e instanceof Error ? e.message : String(e)}`)
          }
        })()
      }}
    />
  )

  return { openPicker: () => setOpen(true), pickerDialog }
}
