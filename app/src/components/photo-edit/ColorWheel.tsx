'use client'

import { useRef } from 'react'
import type { WheelStop } from '@/lib/photo-edit/types'

interface Props {
  label: string
  stop: WheelStop
  onChange: (patch: Partial<WheelStop>) => void
  onEnd: () => void
}

/**
 * A hue/saturation puck. Angle is hue, distance from the centre is saturation,
 * so the neutral position is dead centre — which is also where the grade is a
 * no-op, making "reset" and "looks untouched" the same thing.
 */
export default function ColorWheel({ label, stop, onChange, onEnd }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const pick = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect()
    const dx = (e.clientX - r.left) / r.width - 0.5
    const dy = (e.clientY - r.top) / r.height - 0.5
    const dist = Math.min(0.5, Math.hypot(dx, dy)) / 0.5
    // atan2 measured from 12 o'clock so red sits at the top, as on a colour wheel.
    const hue = (Math.atan2(dx, -dy) * 180) / Math.PI
    onChange({ hue: (hue + 360) % 360, sat: Math.round(dist * 100) })
  }

  const rad = (stop.sat / 100) * 0.5
  const a = (stop.hue * Math.PI) / 180
  const px = 50 + Math.sin(a) * rad * 100
  const py = 50 - Math.cos(a) * rad * 100

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        ref={ref}
        className="relative h-[74px] w-[74px] cursor-crosshair touch-none rounded-full border border-border"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, #808080 0%, transparent 72%), ' +
            'conic-gradient(from 0deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          dragging.current = true
          pick(e)
        }}
        onPointerMove={(e) => { if (dragging.current) pick(e) }}
        onPointerUp={() => { dragging.current = false; onEnd() }}
        onPointerCancel={() => { dragging.current = false; onEnd() }}
        onDoubleClick={() => { onChange({ hue: 0, sat: 0 }); onEnd() }}
      >
        <span
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${px}%`, top: `${py}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground">{label}</span>
      {/* Per-zone luminance — the third axis a flat wheel can't show. */}
      <input
        type="range"
        min={-100}
        max={100}
        value={stop.lum}
        aria-label={`${label} luminance`}
        onChange={(e) => onChange({ lum: Number(e.target.value) })}
        onPointerUp={onEnd}
        onBlur={onEnd}
        onDoubleClick={() => { onChange({ lum: 0 }); onEnd() }}
        className="w-[74px] cursor-pointer accent-primary"
      />
    </div>
  )
}
