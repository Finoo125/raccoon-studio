'use client'

import { useRef } from 'react'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { resizeCrop, type Grip } from '@/lib/photo-edit/geometry'
import type { Crop } from '@/lib/photo-edit/types'

const CORNERS: { grip: Grip; x: (c: Crop) => number; y: (c: Crop) => number }[] = [
  { grip: 'nw', x: (c) => c.x, y: (c) => c.y },
  { grip: 'ne', x: (c) => c.x + c.w, y: (c) => c.y },
  { grip: 'sw', x: (c) => c.x, y: (c) => c.y + c.h },
  { grip: 'se', x: (c) => c.x + c.w, y: (c) => c.y + c.h },
]

const EDGES: { grip: Grip; x: (c: Crop) => number; y: (c: Crop) => number }[] = [
  { grip: 'n', x: (c) => c.x + c.w / 2, y: (c) => c.y },
  { grip: 's', x: (c) => c.x + c.w / 2, y: (c) => c.y + c.h },
  { grip: 'w', x: (c) => c.x, y: (c) => c.y + c.h / 2 },
  { grip: 'e', x: (c) => c.x + c.w, y: (c) => c.y + c.h / 2 },
]

const CURSORS: Record<Grip, string> = {
  move: 'move', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
}

/**
 * Drag handles for the crop rect, drawn over the *uncropped* canvas — EditorCanvas
 * renders with `crop: null` while this tool is active so there is something to drag
 * outward into. Coordinates are normalised to the oriented (post-rotate) image, the
 * same space `EditState.crop` is stored in, so the overlay maps 1:1 onto the canvas.
 */
export default function CropHandles() {
  const crop = usePhotoEditStore((s) => s.editState.crop)
  const rotate = usePhotoEditStore((s) => s.editState.rotate)
  const source = usePhotoEditStore((s) => s.source)
  const aspectLock = usePhotoEditStore((s) => s.aspectLock)
  const setCrop = usePhotoEditStore((s) => s.setCrop)
  const endGesture = usePhotoEditStore((s) => s.endGesture)
  const svgRef = useRef<SVGSVGElement>(null)

  const rect: Crop = crop ?? { x: 0, y: 0, w: 1, h: 1 }

  // Oriented image size — needed to turn a pixel aspect ratio into a normalised one.
  const swap = rotate === 90 || rotate === 270
  const ow = (swap ? source?.height : source?.width) ?? 1
  const oh = (swap ? source?.width : source?.height) ?? 1

  const drag = useRef<{ grip: Grip; startX: number; startY: number; from: Crop } | null>(null)

  const toNorm = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height }
  }

  // Takes the grip as an argument rather than currying: a curried `onDown(grip)`
  // is *called* during render to build the handler, which makes the ref writes
  // inside it read as render-time ref access.
  const onDown = (grip: Grip, e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const { nx, ny } = toNorm(e)
    drag.current = { grip, startX: nx, startY: ny, from: rect }
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    e.stopPropagation()
    const { nx, ny } = toNorm(e)
    setCrop(resizeCrop(d.from, d.grip, nx - d.startX, ny - d.startY, aspectLock, ow, oh))
  }

  const onUp = (e: React.PointerEvent) => {
    if (!drag.current) return
    e.stopPropagation()
    drag.current = null
    endGesture()
  }

  // Everything outside the crop, as one even-odd path — the dim veil.
  const veil = `M0,0 H1 V1 H0 Z M${rect.x},${rect.y} h${rect.w} v${rect.h} h${-rect.w} Z`

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <path d={veil} fillRule="evenodd" fill="rgba(0,0,0,0.55)" />

      {/* Rule-of-thirds guides */}
      {[1 / 3, 2 / 3].map((t) => (
        <g key={t} stroke="rgba(255,255,255,0.35)" strokeWidth={1} vectorEffect="non-scaling-stroke">
          <line x1={rect.x + rect.w * t} y1={rect.y} x2={rect.x + rect.w * t} y2={rect.y + rect.h} />
          <line x1={rect.x} y1={rect.y + rect.h * t} x2={rect.x + rect.w} y2={rect.y + rect.h * t} />
        </g>
      ))}

      <rect
        x={rect.x} y={rect.y} width={rect.w} height={rect.h}
        fill="transparent" stroke="white" strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        style={{ cursor: 'move' }}
        onPointerDown={(e) => onDown('move', e)}
      />

      {/* Grips. Sized in viewBox units and countered by vector-effect so they stay
          a constant on-screen size at any zoom. */}
      {[...CORNERS, ...EDGES].map(({ grip, x, y }) => (
        <rect
          key={grip}
          x={x(rect) - 0.018} y={y(rect) - 0.018} width={0.036} height={0.036}
          fill={CORNERS.some((c) => c.grip === grip) ? 'white' : 'rgba(255,255,255,0.75)'}
          stroke="rgba(0,0,0,0.5)" strokeWidth={1} vectorEffect="non-scaling-stroke"
          style={{ cursor: CURSORS[grip] }}
          onPointerDown={(e) => onDown(grip, e)}
        />
      ))}
    </svg>
  )
}

