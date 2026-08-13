'use client'

import { useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { curveLut } from '@/lib/photo-edit/curve'
import { IDENTITY_CURVE, type CurvePoint, type ToneCurve } from '@/lib/photo-edit/types'
import { cn } from '@/lib/utils'

type Channel = keyof ToneCurve

const CHANNELS: { id: Channel; label: string; stroke: string }[] = [
  { id: 'rgb', label: 'RGB', stroke: '#e8e8e8' },
  { id: 'r', label: 'R', stroke: '#ff6060' },
  { id: 'g', label: 'G', stroke: '#5cff86' },
  { id: 'b', label: 'B', stroke: '#6f9dff' },
]

/** How close (in curve units) a pointer must land to grab an existing point. */
const GRAB = 14

export default function ToneCurveEditor() {
  const curve = usePhotoEditStore((s) => s.editState.curve)
  const setCurve = usePhotoEditStore((s) => s.setCurve)
  const endGesture = usePhotoEditStore((s) => s.endGesture)
  const [channel, setChannel] = useState<Channel>('rgb')
  const svgRef = useRef<SVGSVGElement>(null)
  const dragIndex = useRef<number | null>(null)

  const points = curve[channel]
  const lut = curveLut(points)
  const active = CHANNELS.find((c) => c.id === channel)!

  /** Pointer → curve space (x 0..255 input, y 0..255 output). */
  const toCurve = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(255, ((e.clientX - r.left) / r.width) * 255)),
      y: Math.max(0, Math.min(255, 255 - ((e.clientY - r.top) / r.height) * 255)),
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, y } = toCurve(e)

    const near = points.findIndex((p) => Math.hypot(p.x - x, p.y - y) < GRAB)
    if (near !== -1) { dragIndex.current = near; return }

    // Add a point on the curve where it was clicked, then drag it straight away.
    const next = [...points, { x: Math.round(x), y: lut[Math.round(x)] }].sort((a, b) => a.x - b.x)
    dragIndex.current = next.findIndex((p) => p.x === Math.round(x))
    setCurve(channel, next)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const i = dragIndex.current
    if (i === null) return
    const { x, y } = toCurve(e)
    const next = points.map((p) => ({ ...p }))
    // Endpoints keep their input level and slide vertically; interior points stay
    // strictly between their neighbours so the curve can never fold back on itself.
    if (i > 0 && i < next.length - 1) {
      next[i].x = Math.round(Math.max(next[i - 1].x + 1, Math.min(next[i + 1].x - 1, x)))
    }
    next[i].y = Math.round(y)
    setCurve(channel, next)
  }

  const onPointerUp = () => {
    if (dragIndex.current === null) return
    dragIndex.current = null
    endGesture()
  }

  /** Double-click removes an interior point. */
  const onDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = toCurve(e)
    const near = points.findIndex((p) => Math.hypot(p.x - x, p.y - y) < GRAB)
    if (near <= 0 || near >= points.length - 1) return
    setCurve(channel, points.filter((_, k) => k !== near))
    endGesture()
  }

  const reset = () => {
    setCurve(channel, [...IDENTITY_CURVE])
    endGesture()
  }

  const path = Array.from({ length: 256 }, (_, v) => `${v === 0 ? 'M' : 'L'}${v},${255 - lut[v]}`).join(' ')
  const isModified = (p: CurvePoint[]) => p.length !== 2 || p[0].y !== 0 || p[1].y !== 255

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        {CHANNELS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setChannel(id)}
            className={cn(
              'flex-1 rounded px-2 py-1 text-xs font-medium transition-colors',
              channel === id
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              isModified(curve[id]) && channel !== id && 'text-foreground',
            )}
          >
            {label}
            {isModified(curve[id]) ? ' •' : ''}
          </button>
        ))}
        <button
          type="button"
          title="Reset this channel"
          aria-label="Reset curve"
          onClick={reset}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      <svg
        ref={svgRef}
        viewBox="0 0 255 255"
        preserveAspectRatio="none"
        className="aspect-square w-full touch-none rounded-md border border-border bg-black/40"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <g stroke="rgba(255,255,255,0.12)" strokeWidth={1} vectorEffect="non-scaling-stroke">
          {[0.25, 0.5, 0.75].map((t) => (
            <g key={t}>
              <line x1={255 * t} y1={0} x2={255 * t} y2={255} />
              <line x1={0} y1={255 * t} x2={255} y2={255 * t} />
            </g>
          ))}
          <line x1={0} y1={255} x2={255} y2={0} strokeDasharray="4 4" />
        </g>

        <path d={path} fill="none" stroke={active.stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" />

        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={255 - p.y}
            r={5}
            fill={active.stroke}
            stroke="rgba(0,0,0,0.6)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Click to add a point, drag to shape, double-click a point to remove it.
      </p>
    </div>
  )
}
