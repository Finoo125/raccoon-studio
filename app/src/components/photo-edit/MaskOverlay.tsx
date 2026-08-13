'use client'

import { useRef, useState } from 'react'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import type { BrushStroke } from '@/lib/photo-edit/types'

/** Only points this far apart get recorded — dabs any closer just cost render time. */
const STROKE_STEP = 0.004

/**
 * On-canvas editors for the selected mask: draggable ends for a linear gradient,
 * a centre and two radii for a radial, and freehand painting for a brush.
 * Luminance masks have no geometry, so nothing is drawn for them.
 */
export default function MaskOverlay() {
  const masks = usePhotoEditStore((s) => s.editState.masks)
  const selectedId = usePhotoEditStore((s) => s.selectedMaskId)
  const updateMask = usePhotoEditStore((s) => s.updateMask)
  const endGesture = usePhotoEditStore((s) => s.endGesture)
  const brushRadius = usePhotoEditStore((s) => s.brushRadius)
  const brushErase = usePhotoEditStore((s) => s.brushErase)
  const canvasAspect = usePhotoEditStore((s) => s.canvasAspect)

  const svgRef = useRef<SVGSVGElement>(null)
  const grip = useRef<string | null>(null)
  const [stroke, setStroke] = useState<BrushStroke | null>(null)

  const mask = masks.find((m) => m.id === selectedId)
  if (!mask || mask.kind === 'luminance') return null

  const toNorm = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    }
  }

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, y } = toNorm(e)

    if (mask.kind === 'brush') {
      setStroke({ radius: brushRadius, erase: brushErase, points: [{ x, y }] })
      return
    }
    // Grab whichever handle is nearest the pointer, within a generous radius.
    const handles = handlePositions()
    let best: { id: string; d: number } | null = null
    for (const h of handles) {
      const d = Math.hypot(h.x - x, h.y - y)
      if (d < 0.06 && (!best || d < best.d)) best = { id: h.id, d }
    }
    grip.current = best?.id ?? 'body'
    drag(x, y)
  }

  const onMove = (e: React.PointerEvent) => {
    const { x, y } = toNorm(e)
    if (stroke) {
      e.stopPropagation()
      const last = stroke.points[stroke.points.length - 1]
      if (Math.hypot(x - last.x, y - last.y) < STROKE_STEP) return
      setStroke({ ...stroke, points: [...stroke.points, { x, y }] })
      return
    }
    if (!grip.current) return
    e.stopPropagation()
    drag(x, y)
  }

  const onUp = (e: React.PointerEvent) => {
    if (stroke) {
      e.stopPropagation()
      updateMask(mask.id, { brush: [...(mask.brush ?? []), stroke] })
      setStroke(null)
    }
    grip.current = null
    endGesture()
  }

  function handlePositions() {
    if (mask?.kind === 'linear' && mask.linear) {
      const g = mask.linear
      return [{ id: 'a', x: g.ax, y: g.ay }, { id: 'b', x: g.bx, y: g.by }]
    }
    if (mask?.kind === 'radial' && mask.radial) {
      const r = mask.radial
      return [
        { id: 'c', x: r.cx, y: r.cy },
        { id: 'rx', x: r.cx + r.rx, y: r.cy },
        { id: 'ry', x: r.cx, y: r.cy + r.ry },
      ]
    }
    return []
  }

  function drag(x: number, y: number) {
    if (!mask) return
    if (mask.kind === 'linear' && mask.linear) {
      const g = mask.linear
      if (grip.current === 'a') updateMask(mask.id, { linear: { ...g, ax: x, ay: y } })
      else if (grip.current === 'b') updateMask(mask.id, { linear: { ...g, bx: x, by: y } })
      return
    }
    if (mask.kind === 'radial' && mask.radial) {
      const r = mask.radial
      if (grip.current === 'c') updateMask(mask.id, { radial: { ...r, cx: x, cy: y } })
      else if (grip.current === 'rx') updateMask(mask.id, { radial: { ...r, rx: Math.max(0.02, Math.abs(x - r.cx)) } })
      else if (grip.current === 'ry') updateMask(mask.id, { radial: { ...r, ry: Math.max(0.02, Math.abs(y - r.cy)) } })
    }
  }

  const dabs = [...(mask.brush ?? []), ...(stroke ? [stroke] : [])]

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      className={mask.kind === 'brush'
        ? 'absolute inset-0 h-full w-full cursor-crosshair touch-none'
        : 'absolute inset-0 h-full w-full touch-none'}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {mask.kind === 'linear' && mask.linear && (
        <g>
          <line
            x1={mask.linear.ax} y1={mask.linear.ay} x2={mask.linear.bx} y2={mask.linear.by}
            stroke="white" strokeWidth={1.5} strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
          {handlePositions().map((h) => (
            <circle key={h.id} cx={h.x} cy={h.y} r={0.016} fill="white" stroke="rgba(0,0,0,0.6)"
              strokeWidth={1} vectorEffect="non-scaling-stroke" style={{ cursor: 'grab' }} />
          ))}
        </g>
      )}

      {mask.kind === 'radial' && mask.radial && (
        <g>
          <ellipse
            cx={mask.radial.cx} cy={mask.radial.cy} rx={mask.radial.rx} ry={mask.radial.ry}
            fill="rgba(255,255,255,0.06)" stroke="white" strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          {handlePositions().map((h) => (
            <circle key={h.id} cx={h.x} cy={h.y} r={0.016} fill="white" stroke="rgba(0,0,0,0.6)"
              strokeWidth={1} vectorEffect="non-scaling-stroke" style={{ cursor: 'grab' }} />
          ))}
        </g>
      )}

      {mask.kind === 'brush' && dabs.map((s, i) => (
        <g key={i} fill={s.erase ? 'rgba(255,90,90,0.28)' : 'rgba(120,190,255,0.28)'}>
          {s.points.map((p, k) => (
            // The viewBox is 1×1 with preserveAspectRatio="none", so a <circle>
            // draws as an ellipse on any non-square image. The brush radius is a
            // fraction of *width*, so the y radius has to be scaled by the aspect
            // to come out the same number of pixels — matching buildMask.
            <ellipse key={k} cx={p.x} cy={p.y} rx={s.radius} ry={s.radius * canvasAspect} />
          ))}
        </g>
      ))}
    </svg>
  )
}
