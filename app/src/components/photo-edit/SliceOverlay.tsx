'use client'

import { useRef, useState } from 'react'
import { usePhotoEditStore } from '@/lib/photo-edit/store'

/** Cross product sign test matching applySliceMask in pipeline.ts. */
function crossSign(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax)
}

export default function SliceOverlay() {
  const slice = usePhotoEditStore((s) => s.editState.slice)
  const setSlice = usePhotoEditStore((s) => s.setSlice)
  const svgRef = useRef<SVGSVGElement>(null)

  // Local drag state: start point + current point while drawing a new line.
  const [draft, setDraft] = useState<{ ax: number; ay: number; bx: number; by: number } | null>(null)
  const drawingRef = useRef(false)

  /** Pointer → normalized [0..1] coords within the overlay rect. */
  const toNorm = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect()
    const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    return { nx, ny }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const { nx, ny } = toNorm(e)

    // If a committed slice exists, a click just re-picks the keep side.
    if (slice && !drawingRef.current) {
      const sign = crossSign(slice.ax, slice.ay, slice.bx, slice.by, nx, ny)
      setSlice({ ...slice, keep: sign >= 0 ? 'a' : 'b' })
      return
    }
    drawingRef.current = true
    setDraft({ ax: nx, ay: ny, bx: nx, by: ny })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current || !draft) return
    e.stopPropagation()
    const { nx, ny } = toNorm(e)
    setDraft({ ...draft, bx: nx, by: ny })
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drawingRef.current || !draft) return
    e.stopPropagation()
    drawingRef.current = false
    const moved = Math.hypot(draft.bx - draft.ax, draft.by - draft.ay) > 0.02
    setDraft(null)
    if (moved) setSlice({ ax: draft.ax, ay: draft.ay, bx: draft.bx, by: draft.by, keep: 'a' })
  }

  const line = draft ?? slice

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full cursor-crosshair"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {line && (
        <line
          x1={line.ax}
          y1={line.ay}
          x2={line.bx}
          y2={line.by}
          stroke="white"
          strokeWidth={0.006}
          vectorEffect="non-scaling-stroke"
          style={{ filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.8))' }}
        />
      )}
    </svg>
  )
}
