'use client'

import Image from 'next/image'
import { useState, useEffect } from 'react'
import { Heart, X, Send, ChevronLeft, ChevronRight, FolderOpen, Maximize2, Download, Pencil, Trash2, Clapperboard, ImagePlus } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import MoviePickerDialog from './MoviePickerDialog'
import { useGalleryStore } from '@/lib/gallery/store'
import { useRouter } from 'next/navigation'

export default function GalleryInspector() {
  const { selected, images, setSelected, toggleFavorite, removeImages } = useGalleryStore()
  const router = useRouter()
  // Full-size lightbox shown in front of the gallery when the preview is clicked.
  const [lightbox, setLightbox] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [movieOpen, setMovieOpen] = useState(false)
  const [tagInput, setTagInput] = useState('')

  // Close the lightbox on Escape, and never leave it open across image changes.
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lightbox])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset overlay when the selected image changes
  useEffect(() => { setLightbox(false) }, [selected?.id])

  if (!selected) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Select an image to inspect
      </div>
    )
  }

  const idx = images.findIndex((i) => i.id === selected.id)
  const prev = idx > 0 ? images[idx - 1] : null
  const next = idx < images.length - 1 ? images[idx + 1] : null

  const handleFavorite = async () => {
    const newVal = !selected.favorite
    toggleFavorite(selected.id)
    await fetch('/api/gallery/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selected.id, value: newVal }),
    })
    toast.success(newVal ? 'Added to favorites' : 'Removed from favorites')
  }

  const handleOpenFolder = async () => {
    if (!selected.dir) {
      toast.error('Folder path unavailable — rescan the gallery')
      return
    }
    const res = await fetch('/api/system/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: selected.dir }),
    })
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({ error: 'Failed' }))) as { error?: string }
      toast.error(error ?? 'Could not open folder')
    }
  }

  const handleEdit = () => {
    const params = new URLSearchParams({ subfolder: selected.subfolder, filename: selected.filename })
    router.push(`/photo-editing?${params}`)
  }

  const handleDownload = () => {
    // Same-origin image route, so the anchor's download attribute saves the file
    // to disk with its original filename without opening it in the browser.
    const a = document.createElement('a')
    a.href = selected.url
    a.download = selected.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast.success('Saving image…')
  }

  const handleDelete = async () => {
    const res = await fetch('/api/gallery/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [selected.id] }),
    })
    const { deleted } = (await res.json()) as { deleted: string[] }
    if (deleted.length) { removeImages(deleted); toast.success('Deleted') }
  }

  const addTag = async () => {
    const tag = tagInput.trim()
    if (!tag) return
    await fetch('/api/gallery/tags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [selected.id], add: tag }),
    })
    useGalleryStore.setState((s) => ({
      images: s.images.map((i) => i.id === selected.id && !i.tags?.includes(tag) ? { ...i, tags: [...(i.tags ?? []), tag] } : i),
      selected: s.selected ? { ...s.selected, tags: [...(s.selected.tags ?? []), tag] } : s.selected,
    }))
    setTagInput('')
  }

  const removeTag = async (tag: string) => {
    await fetch('/api/gallery/tags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [selected.id], remove: tag }),
    })
    useGalleryStore.setState((s) => ({
      images: s.images.map((i) => i.id === selected.id ? { ...i, tags: (i.tags ?? []).filter((t) => t !== tag) } : i),
      selected: s.selected ? { ...s.selected, tags: (s.selected.tags ?? []).filter((t) => t !== tag) } : s.selected,
    }))
  }

  const isVideo = selected.media === 'video'

  const handleSendToGenerate = () => {
    const params = new URLSearchParams()
    if (selected.metadata.prompt) params.set('prompt', selected.metadata.prompt)
    if (selected.metadata.negativePrompt) params.set('negative', selected.metadata.negativePrompt)
    if (selected.metadata.seed !== undefined) params.set('seed', String(selected.metadata.seed))
    if (selected.metadata.workflow) params.set('workflow', selected.metadata.workflow.toLowerCase())
    router.push(`${isVideo ? '/generate-videos' : '/generate'}?${params}`)
    toast.success(`Settings sent to ${isVideo ? 'Generate Videos' : 'Generate'} page`)
  }

  // "Send as base" — open the Generate page with this image preloaded as the
  // img2img/inpaint/outpaint base (the form re-uploads it to ComfyUI's input dir).
  const handleSendAsBase = () => {
    router.push(`/generate?base=${encodeURIComponent(selected.url)}`)
    toast.success('Opening as base image in Generate')
  }

  const m = selected.metadata

  return (
    <>
    <AnimatePresence mode="wait">
      <motion.div
        key={selected.id}
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -12 }}
        transition={{ duration: 0.15 }}
        className="flex flex-col h-full overflow-hidden"
      >
        {/* Image preview — fixed top half so the details below stay reachable.
            Clicking the image opens a full-size lightbox in front of the gallery. */}
        <div className="relative h-[45vh] shrink-0 bg-muted group">
          {isVideo ? (
            <video
              key={selected.id}
              src={selected.url}
              controls
              autoPlay
              loop
              className="absolute inset-0 h-full w-full object-contain bg-black"
            />
          ) : (
            <>
              <button
                type="button"
                onClick={() => setLightbox(true)}
                className="absolute inset-0 h-full w-full cursor-zoom-in"
                title="Click to view full size"
                aria-label="View full size"
              >
                <Image
                  src={selected.url}
                  alt={m.prompt ?? selected.filename}
                  fill
                  className="object-contain"
                  unoptimized
                  priority
                />
              </button>
              {/* Hint — tells the user the preview is clickable */}
              <span className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white opacity-90 transition-opacity group-hover:opacity-100">
                <Maximize2 className="h-3 w-3" /> Click image for full size
              </span>
            </>
          )}
          <button
            onClick={() => setSelected(null)}
            className="absolute top-2 right-2 rounded-full bg-black/50 p-1 text-white hover:bg-black/70"
            title="Close inspector"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable details — independently scrolls under the fixed image */}
        <div className="flex-1 min-h-0 overflow-y-auto">

        {/* Navigation — previous / next image */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            disabled={!prev}
            onClick={() => prev && setSelected(prev)}
          >
            <ChevronLeft className="h-4 w-4" /> Previous
          </Button>
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            {idx + 1} of {images.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            disabled={!next}
            onClick={() => next && setSelected(next)}
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Actions — large, clearly labelled buttons */}
        <div className="px-4 pt-4 space-y-2.5">
          <Button className="w-full h-11 text-sm font-semibold" onClick={handleSendToGenerate}>
            <Send className="h-4 w-4 mr-2" /> Send to Generate
          </Button>
          {!isVideo && (
            <Button variant="outline" className="w-full h-11 text-sm font-semibold" onClick={handleSendAsBase}>
              <ImagePlus className="h-4 w-4 mr-2" /> Send as base image
            </Button>
          )}
          {!isVideo && (
            <Button variant="outline" className="w-full h-11 text-sm font-semibold" onClick={handleEdit}>
              <Pencil className="h-4 w-4 mr-2" /> Send to Photo Editor
            </Button>
          )}
          <Button variant="outline" className="w-full h-11 text-sm font-semibold" onClick={() => setMovieOpen(true)}>
            <Clapperboard className="h-4 w-4 mr-2" /> Send to Movie Maker
          </Button>
          <div className={`grid ${isVideo ? 'grid-cols-4' : 'grid-cols-5'} gap-2`}>
            <Button
              variant="outline"
              className="h-11 flex-col gap-1 text-xs"
              onClick={handleFavorite}
            >
              <Heart className={`h-4 w-4 ${selected.favorite ? 'fill-rose-500 text-rose-500' : ''}`} />
              {selected.favorite ? 'Favorited' : 'Favorite'}
            </Button>
            <Button
              variant="outline"
              className="h-11 flex-col gap-1 text-xs"
              onClick={() => void handleOpenFolder()}
            >
              <FolderOpen className="h-4 w-4" />
              Open folder
            </Button>
            <Button
              variant="outline"
              className="h-11 flex-col gap-1 text-xs"
              onClick={handleDownload}
            >
              <Download className="h-4 w-4" />
              {isVideo ? 'Save video' : 'Save image'}
            </Button>
            {!isVideo && (
              <Button
                variant="outline"
                className="h-11 flex-col gap-1 text-xs"
                onClick={() => setLightbox(true)}
              >
                <Maximize2 className="h-4 w-4" />
                Full size
              </Button>
            )}
            <Button
              variant="outline"
              className="h-11 flex-col gap-1 text-xs text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>

        {/* Generation metadata — shown beneath the action buttons */}
        <div className="px-4 py-4 space-y-3.5 text-sm">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Generation details</p>

          {m.workflow && (
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary">{m.workflow}</Badge>
              {m.model && <span className="text-xs text-muted-foreground break-all">{m.model}</span>}
            </div>
          )}

          {m.prompt && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Prompt</p>
              <p className="text-sm leading-relaxed">{m.prompt}</p>
            </div>
          )}

          {m.negativePrompt && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Negative</p>
              <p className="text-sm leading-relaxed text-muted-foreground">{m.negativePrompt}</p>
            </div>
          )}

          <Separator />

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {m.seed !== undefined && <MetaRow label="Seed" value={String(m.seed)} />}
            {m.steps !== undefined && <MetaRow label="Steps" value={String(m.steps)} />}
            {m.cfg !== undefined && <MetaRow label="CFG" value={String(m.cfg)} />}
            {m.sampler && <MetaRow label="Sampler" value={m.sampler} />}
            {m.scheduler && <MetaRow label="Scheduler" value={m.scheduler} />}
            {m.width && m.height && <MetaRow label="Size" value={`${m.width}×${m.height}`} />}
          </div>

          {m.prompt === undefined &&
            m.seed === undefined &&
            m.steps === undefined &&
            m.sampler === undefined && (
              <p className="text-xs text-muted-foreground italic">
                No embedded generation metadata found in this file.
              </p>
            )}

          <Separator />

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Tags</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {(selected.tags ?? []).map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
                  {t}
                  <button onClick={() => void removeTag(t)} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                </span>
              ))}
              <input
                value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void addTag() }}
                placeholder="Add tag…"
                className="h-7 w-28 rounded-full border border-input bg-background px-3 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-1 text-xs text-muted-foreground">
            <p className="break-all">{selected.filename}</p>
            <p>{new Date(selected.createdAt).toLocaleString()}</p>
          </div>
        </div>
        </div>
      </motion.div>
    </AnimatePresence>

    {/* Full-size lightbox — image-only (videos play inline with controls) */}
    {lightbox && !isVideo && (
      <div
        className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm"
        onClick={() => setLightbox(false)}
        role="dialog"
        aria-modal="true"
      >
        <div className="relative h-full w-full p-6" onClick={() => setLightbox(false)}>
          <Image
            src={selected.url}
            alt={m.prompt ?? selected.filename}
            fill
            className="object-contain p-6"
            unoptimized
            priority
          />
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setLightbox(false) }}
          className="absolute top-4 right-4 z-10 flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
          title="Close full size (Esc)"
          aria-label="Close full size"
        >
          <X className="h-5 w-5" /> Close
        </button>
      </div>
    )}

    <ConfirmDialog
      open={confirmDelete} onOpenChange={setConfirmDelete}
      title="Delete this item?" description="This permanently removes the file from disk and cannot be undone."
      confirmLabel="Delete" destructive onConfirm={() => void handleDelete()}
    />
    <MoviePickerDialog open={movieOpen} onOpenChange={setMovieOpen} item={{ dir: selected.dir, filename: selected.filename }} />
    </>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-mono break-all">{value}</span>
    </div>
  )
}
