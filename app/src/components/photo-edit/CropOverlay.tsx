'use client'

// NOTE: Interactive drag-handles over the canvas for freeform crop are deferred as a follow-up
// (DONE_WITH_CONCERNS). This panel provides the robust subset: aspect-ratio presets, straighten
// slider, rotate-90, flip-H, and flip-V. These map cleanly to the store's setCrop / setGeometry
// actions. A follow-up task can add canvas pointer-event drag handles on top of EditorCanvas.

import { FlipHorizontal, FlipVertical, RotateCw } from 'lucide-react'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { ASPECT_RATIOS } from '@/lib/photo-edit/geometry'
import { cn } from '@/lib/utils'
import SliderRow from './SliderRow'

export default function CropOverlay() {
  const editState = usePhotoEditStore((s) => s.editState)
  const source = usePhotoEditStore((s) => s.source)
  const setCrop = usePhotoEditStore((s) => s.setCrop)
  const setGeometry = usePhotoEditStore((s) => s.setGeometry)

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
    <div className="flex flex-col gap-4 overflow-y-auto px-3 py-2">
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

      {/* Current crop info (read-only, informational) */}
      {editState.crop && (
        <div className="rounded-md bg-muted/40 px-2 py-1.5 text-[10px] text-muted-foreground">
          Crop: {Math.round(editState.crop.w * 100)}% × {Math.round(editState.crop.h * 100)}%
          {' '}centered at ({Math.round(editState.crop.x * 100)}%, {Math.round(editState.crop.y * 100)}%)
        </div>
      )}
    </div>
  )
}
