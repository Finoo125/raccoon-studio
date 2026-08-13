'use client'

import { useRef, useState } from 'react'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { sliceVeil, VEIL_SPAN } from '@/lib/photo-edit/geometry'

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

  // A drag commits with keep: 'a', so previewing the draft with that same value
  // shows the real outcome *before* the pointer comes up — which side survives
  // depends on the direction you drag, and that was invisible until now.
  const line = draft ? { ...draft, keep: 'a' as const } : slice
  const veil = line ? sliceVeil(line) : null

  return (
    <>
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
        {/* The half that goes. One oversized rect laid along the cut — the SVG
            viewport clips whatever hangs outside the frame. */}
        {veil && (
          <rect
            x={-VEIL_SPAN}
            y={veil.y}
            width={VEIL_SPAN * 2}
            height={VEIL_SPAN}
            fill="rgba(0,0,0,0.55)"
            transform={`translate(${line!.ax} ${line!.ay}) rotate(${veil.angle})`}
          />
        )}

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

      {/* Named, not just shaded: a dim half could read as a vignette or a mask.
          Outside the SVG because preserveAspectRatio="none" would stretch text. */}
      {veil && (
        <span
          data-slice-tag=""
          className="pointer-events-none absolute rounded-full bg-black/75 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-white/90 backdrop-blur-sm"
          style={{
            left: `${veil.label.x * 100}%`,
            top: `${veil.label.y * 100}%`,
            // Undo the canvas zoom so the tag is the same size at 20% or 400%.
            transform: 'translate(-50%, -50%) scale(calc(1 / var(--pe-zoom, 1)))',
          }}
        >
          Removed
        </span>
      )}
    </>
  )
}
