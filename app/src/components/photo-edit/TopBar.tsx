'use client'

import { useState } from 'react'
import { Undo2, Redo2, RotateCcw, ChevronDown, Save, Wand2, Images } from 'lucide-react'
import { toast } from 'sonner'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { renderToCanvas } from '@/lib/photo-edit/pipeline'
import { computeAutoAdjustments } from '@/lib/photo-edit/auto-enhance'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type Format = 'png' | 'jpeg'

export default function TopBar() {
  const origin = usePhotoEditStore((s) => s.origin)
  const source = usePhotoEditStore((s) => s.source)
  const editState = usePhotoEditStore((s) => s.editState)
  const historyIndex = usePhotoEditStore((s) => s.historyIndex)
  const history = usePhotoEditStore((s) => s.history)
  const saving = usePhotoEditStore((s) => s.saving)
  const undo = usePhotoEditStore((s) => s.undo)
  const redo = usePhotoEditStore((s) => s.redo)
  const resetAll = usePhotoEditStore((s) => s.resetAll)
  const setSaving = usePhotoEditStore((s) => s.setSaving)
  const mergeAdjustments = usePhotoEditStore((s) => s.mergeAdjustments)
  const openPicker = usePhotoEditStore((s) => s.openPicker)

  const [format, setFormat] = useState<Format>('png')
  const [confirmOverwriteOpen, setConfirmOverwriteOpen] = useState(false)
  const [confirmSwitchOpen, setConfirmSwitchOpen] = useState(false)
  const [savePopoverOpen, setSavePopoverOpen] = useState(false)

  const canUndo = historyIndex > 0
  const canRedo = historyIndex < history.length - 1
  const isUpload = origin?.kind === 'upload'
  const filename = origin?.filename ?? 'Canvas'

  async function performSave(mode: 'copy' | 'overwrite') {
    if (!source || !origin) return
    setSaving(true)
    setSavePopoverOpen(false)
    try {
      const canvas = document.createElement('canvas')
      renderToCanvas(source, editState, canvas)

      const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png'
      const quality = format === 'jpeg' ? 0.92 : undefined

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, mimeType, quality)
      })
      if (!blob) throw new Error('Canvas export failed')

      const subfolder = origin.kind === 'gallery' ? origin.subfolder : ''
      const fd = new FormData()
      fd.append('file', blob, filename)
      fd.append('mode', mode)
      fd.append('subfolder', subfolder)
      fd.append('filename', filename)

      const res = await fetch('/api/photo-edit/save', { method: 'POST', body: fd })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as { filename: string; subfolder: string }
      toast.success(`Saved as ${data.filename}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Save failed: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAsCopy = () => {
    void performSave('copy')
  }

  const handleOverwriteConfirmed = () => {
    setConfirmOverwriteOpen(false)
    void performSave('overwrite')
  }

  // Switching discards unsaved edits, so confirm first when any exist.
  const handleSwitch = () => {
    if (canUndo) {
      setConfirmSwitchOpen(true)
    } else {
      openPicker()
    }
  }

  const handleAutoEnhance = () => {
    if (!source) return
    // Downscale to ≤128px for a fast histogram, then read pixels.
    const scale = 128 / Math.max(source.width, source.height)
    const w = Math.max(1, Math.round(source.width * Math.min(1, scale)))
    const h = Math.max(1, Math.round(source.height * Math.min(1, scale)))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(source, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    const adj = computeAutoAdjustments({ data, width: w, height: h })
    if (Object.keys(adj).length === 0) {
      toast.info('Image already looks balanced')
      return
    }
    mergeAdjustments(adj)
    toast.success('Auto-enhance applied')
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card/40 px-3">
      {/* Filename */}
      <span className="min-w-0 truncate text-xs font-medium text-foreground">
        {filename}
      </span>

      {/* Switch image */}
      <Button
        variant="ghost"
        size="sm"
        title="Switch to another image from the gallery"
        disabled={!source}
        onClick={handleSwitch}
      >
        <Images className="h-3.5 w-3.5" />
        Switch image
      </Button>

      <div className="flex-1" />

      {/* Before/after hint */}
      <span className="hidden text-[10px] text-muted-foreground sm:block">
        Hold Compare for before/after
      </span>

      {/* Undo / Redo */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          title="Undo"
          aria-label="Undo"
          disabled={!canUndo}
          onClick={undo}
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Redo"
          aria-label="Redo"
          disabled={!canRedo}
          onClick={redo}
        >
          <Redo2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Auto-enhance"
          aria-label="Auto-enhance"
          disabled={!source}
          onClick={handleAutoEnhance}
        >
          <Wand2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Reset all edits"
          aria-label="Reset all"
          onClick={resetAll}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Save menu */}
      <Popover open={savePopoverOpen} onOpenChange={setSavePopoverOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="default"
              size="sm"
              disabled={saving || !source}
            />
          }
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Saving…' : 'Save'}
          <ChevronDown className="h-3 w-3" />
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="w-56 p-2">
          {/* Format selector */}
          <div className="mb-2 flex items-center gap-2 px-1">
            <span className="text-xs text-muted-foreground">Format</span>
            <div className="flex gap-1">
              {(['png', 'jpeg'] as Format[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  className={cn(
                    'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                    format === f
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Save as new copy */}
          <button
            type="button"
            onClick={handleSaveAsCopy}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted"
          >
            Save as new copy
          </button>

          {/* Overwrite original */}
          <button
            type="button"
            disabled={isUpload}
            title={isUpload ? 'Cannot overwrite an uploaded file — save as copy instead' : undefined}
            onClick={() => {
              setSavePopoverOpen(false)
              setConfirmOverwriteOpen(true)
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs',
              isUpload
                ? 'cursor-not-allowed opacity-40'
                : 'hover:bg-muted',
            )}
          >
            Overwrite original
          </button>
        </PopoverContent>
      </Popover>

      {/* Overwrite confirm dialog */}
      <Dialog open={confirmOverwriteOpen} onOpenChange={setConfirmOverwriteOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Overwrite original?</DialogTitle>
            <DialogDescription>
              This will permanently replace <strong>{filename}</strong> with your edited version.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={<Button variant="outline" />}
            >
              Cancel
            </DialogClose>
            <Button variant="destructive" onClick={handleOverwriteConfirmed}>
              Overwrite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Switch-image confirm (only shown when there are unsaved edits) */}
      <Dialog open={confirmSwitchOpen} onOpenChange={setConfirmSwitchOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Switch image?</DialogTitle>
            <DialogDescription>
              Your unsaved edits to <strong>{filename}</strong> will be discarded.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmSwitchOpen(false)
                openPicker()
              }}
            >
              Switch image
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
