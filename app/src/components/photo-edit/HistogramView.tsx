'use client'

import { useEffect, useRef } from 'react'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import type { Histogram } from '@/lib/photo-edit/histogram'

const W = 256
const H = 68

/** Additive fills, so overlapping channels read as the usual grey/yellow/cyan mix. */
const CHANNELS: { key: 'r' | 'g' | 'b'; color: string }[] = [
  { key: 'r', color: 'rgba(255,80,80,0.75)' },
  { key: 'g', color: 'rgba(80,255,120,0.75)' },
  { key: 'b', color: 'rgba(90,140,255,0.75)' },
]

function draw(ctx: CanvasRenderingContext2D, h: Histogram) {
  ctx.clearRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'lighter'
  for (const { key, color } of CHANNELS) {
    const bins = h[key]
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let v = 0; v < 256; v++) {
      // sqrt keeps the small bins visible next to a dominant peak without a log
      // scale's habit of making an empty histogram look busy.
      const t = Math.min(1, Math.sqrt(bins[v] / h.peak))
      ctx.lineTo(v, H - t * H)
    }
    ctx.lineTo(255, H)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
}

export default function HistogramView() {
  const histogram = usePhotoEditStore((s) => s.histogram)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx || !histogram) return
    draw(ctx, histogram)
  }, [histogram])

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`

  return (
    <div className="mb-2">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="block h-[68px] w-full rounded-md border border-border bg-black/40"
      />
      {/* Clipping readout — the reason to look at a histogram at all. */}
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span className={histogram && histogram.clippedLow > 0.005 ? 'text-amber-400' : undefined}>
          ▼ {histogram ? pct(histogram.clippedLow) : '—'}
        </span>
        <span className={histogram && histogram.clippedHigh > 0.005 ? 'text-amber-400' : undefined}>
          {histogram ? pct(histogram.clippedHigh) : '—'} ▲
        </span>
      </div>
    </div>
  )
}
