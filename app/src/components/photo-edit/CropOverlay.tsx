'use client'

// The panel side of cropping: aspect presets, straighten, rotate-90, flip. The
// draggable rect itself lives in CropHandles, drawn over the canvas.

import { useEffect, useRef } from 'react'
import { Check, FlipHorizontal, FlipVertical, RotateCw, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { ASPECT_RATIOS } from '@/lib/photo-edit/geometry'
import { placement } from '@/lib/photo-edit/pipeline'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { EditState } from '@/lib/photo-edit/types'
import SliderRow from './SliderRow'

/** The geometry fields Apply/Cancel own. */
type Geometry = Pick<EditState, 'crop' | 'rotate' | 'straighten' | 'flipH' | 'flipV'>

export default function CropOverlay() {
  const editState = usePhotoEditStore((s) => s.editState)
  const source = usePhotoEditStore((s) => s.source)
  const setCrop = usePhotoEditStore((s) => s.setCrop)
  const setGeometry = usePhotoEditStore((s) => s.setGeometry)
  const setAspectLock = usePhotoEditStore((s) => s.setAspectLock)
  const setCanvasMode = usePhotoEditStore((s) => s.setCanvasMode)
  const toggleSection = usePhotoEditStore((s) => s.toggleSection)
  const showHint = usePhotoEditStore((s) => !s.dismissedHints.includes('crop'))

  // What the geometry looked like when this panel opened, so Cancel can put it
  // back rather than resetting to defaults and throwing away an earlier crop.
  const baseline = useRef<Geometry | null>(null)
  useEffect(() => {
    const { crop, rotate, straighten, flipH, flipV } = usePhotoEditStore.getState().editState
    baseline.current = { crop, rotate, straighten, flipH, flipV }
  }, [])

  /** Close the tool and hand the canvas back — the "that's done" moment. */
  const finish = () => {
    setCanvasMode('edit')
    if (usePhotoEditStore.getState().openSections.includes('crop')) toggleSection('crop')
  }

  const handleApply = () => {
    finish()
    if (!source) return
    const p = placement(source.width, source.height, usePhotoEditStore.getState().editState)
    toast.success(`Cropped to ${p.cw} × ${p.ch}`)
  }

  const handleCancel = () => {
    if (baseline.current) {
      setGeometry(baseline.current)
      setAspectLock(null)
    }
    finish()
  }

  /** Determine which aspect-ratio button is currently selected. */
  const currentAspect = (() => {
    if (!editState.crop) return 'original'
    const { w, h } = editState.crop
    if (h === 0) return 'original'
    const ratio = w / h
    for (const ar of ASPECT_RATIOS) {
      if (ar.value !== null && Math.abs(ratio - ar.value) < 0.01) return ar.id
    }
    return null // custom
  })()

  const handleAspect = (id: string, value: number | null) => {
    // Picking a ratio also locks the drag handles to it; 'Original' frees them.
    setAspectLock(value)
    if (value === null) {
      // 'Original' — clear crop
      setCrop(null)
      return
    }
    if (!source) return
    // Compute a centered crop for the given aspect ratio.
    // We work in the oriented-size space (after rotate).
    const rot = editState.rotate
    const ow = rot === 90 || rot === 270 ? source.height : source.width
    const oh = rot === 90 || rot === 270 ? source.width : source.height
    const imageAspect = ow / oh

    let cw: number, ch: number
    if (value >= imageAspect) {
      // Landscape ratio is wider than source — letterbox: full width, restricted height
      cw = 1
      ch = imageAspect / value
    } else {
      // Portrait ratio is taller — pillarbox: full height, restricted width
      ch = 1
      cw = value / imageAspect
    }
    const cx = (1 - cw) / 2
    const cy = (1 - ch) / 2
    setCrop({ x: cx, y: cy, w: cw, h: ch })
  }

  const handleRotate90 = () => {
    const next = ((editState.rotate + 90) % 360) as 0 | 90 | 180 | 270
    setGeometry({ rotate: next })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Aspect ratios */}
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Aspect Ratio
        </p>
        <div className="flex flex-wrap gap-1.5">
          {ASPECT_RATIOS.map(({ id, label, value }) => (
            <button
              key={id}
              type="button"
              onClick={() => handleAspect(id, value)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                currentAspect === id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Straighten */}
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Straighten
        </p>
        <SliderRow
          label="Angle"
          value={editState.straighten}
          min={-45}
          max={45}
          step={0.5}
          showHint={showHint}
          onChange={(v) => setGeometry({ straighten: v })}
          onReset={() => setGeometry({ straighten: 0 })}
        />
      </div>

      {/* Rotate & Flip */}
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Transform
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            title="Rotate 90° clockwise"
            onClick={handleRotate90}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Rotate 90°
          </button>
          <button
            type="button"
            title="Flip horizontal"
            onClick={() => setGeometry({ flipH: !editState.flipH })}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
              editState.flipH
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
            )}
          >
            <FlipHorizontal className="h-3.5 w-3.5" />
            Flip H
          </button>
          <button
            type="button"
            title="Flip vertical"
            onClick={() => setGeometry({ flipV: !editState.flipV })}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
              editState.flipV
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
            )}
          >
            <FlipVertical className="h-3.5 w-3.5" />
            Flip V
          </button>
        </div>
      </div>

      {/* What you will actually get, in pixels — percentages of an unstated
          original never answered the question anyone is asking here. */}
      {source && (
        <div
          data-crop-readout=""
          className="rounded-md bg-muted/40 px-2 py-1.5 text-[10px] text-muted-foreground"
        >
          Output:{' '}
          <span className="font-medium tabular-nums text-foreground">
            {placement(source.width, source.height, editState).cw}
            {' × '}
            {placement(source.width, source.height, editState).ch} px
          </span>
        </div>
      )}

      {/* Confirm pair. The crop is non-destructive either way — Apply commits it
          and closes the tool, so the edit reads as finished instead of leaving
          the overlay hanging around with no obvious way to say "done". */}
      <div className="flex gap-1.5">
        <Button variant="default" size="sm" className="flex-1" onClick={handleApply}>
          <Check className="h-3.5 w-3.5" />
          Apply crop
        </Button>
        <Button variant="outline" size="sm" onClick={handleCancel}>
          <Undo2 className="h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>
    </div>
  )
}
