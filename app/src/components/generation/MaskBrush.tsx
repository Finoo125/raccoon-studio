'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Eraser, Paintbrush, RotateCcw, FlipHorizontal2 } from 'lucide-react'
import { canvasToMaskBlob, hasPaintedPixels } from '@/lib/generation/mask'

export interface MaskBrushHandle {
  /** Binary B/W PNG mask blob honouring the current invert state, or null if nothing painted. */
  exportMask(): Promise<Blob | null>
}

interface Props {
  /** URL of the base image to paint over (object URL or API view URL). */
  src: string
  /** Optional notify on whether any strokes exist (for parent validation). */
  onPaintedChange?: (painted: boolean) => void
}

/** The brush stroke colour — bright magenta so it reads against any image. */
const STROKE = 'rgba(236, 72, 153, 0.55)'

/**
 * Paint-over-the-image inpaint mask editor. Renders the base image with a
 * transparent canvas overlay at the image's native resolution; the user paints
 * the area to regenerate. `exportMask` (via ref) yields a binary PNG where the
 * painted area is white (or the unpainted area, when inverted) — see
 * {@link canvasToMaskBlob}. Supports mouse and touch via pointer events.
 */
const MaskBrush = forwardRef<MaskBrushHandle, Props>(function MaskBrush({ src, onPaintedChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)

  const [brushSize, setBrushSize] = useState(64)
  const [erase, setErase] = useState(false)
  const [invert, setInvert] = useState(false)
  const [ready, setReady] = useState(false)

  // Size the canvas to the image's natural resolution once it loads, so the
  // exported mask aligns with the source the workflow will encode.
  function syncCanvasToImage() {
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!img || !canvas) return
    if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
    }
    setReady(true)
  }

  // Reset the canvas whenever the base image changes.
  useEffect(() => {
    setReady(false)
    last.current = null
    onPaintedChange?.(false)
    const img = imgRef.current
    if (img?.complete && img.naturalWidth > 0) syncCanvasToImage()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional re-init on src change only
  }, [src])

  useImperativeHandle(ref, () => ({
    async exportMask() {
      const canvas = canvasRef.current
      if (!canvas) return null
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      if (!invert && !hasPaintedPixels(data)) return null
      return canvasToMaskBlob(canvas, { invert })
    },
  }), [invert])

  /** Maps a pointer event to canvas-internal pixel coordinates. */
  function toCanvasPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  function strokeTo(x: number, y: number) {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
    ctx.strokeStyle = STROKE
    ctx.fillStyle = STROKE
    ctx.lineWidth = brushSize
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (last.current) {
      ctx.beginPath()
      ctx.moveTo(last.current.x, last.current.y)
      ctx.lineTo(x, y)
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2)
      ctx.fill()
    }
    last.current = { x, y }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready) return
    e.preventDefault()
    canvasRef.current?.setPointerCapture(e.pointerId)
    drawing.current = true
    last.current = null
    const { x, y } = toCanvasPoint(e)
    strokeTo(x, y)
    onPaintedChange?.(!erase)
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    e.preventDefault()
    const { x, y } = toCanvasPoint(e)
    strokeTo(x, y)
  }

  function endStroke() {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) {
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      onPaintedChange?.(hasPaintedPixels(data))
    }
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    onPaintedChange?.(false)
  }

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-xl border border-border bg-muted/20">
        {/* eslint-disable-next-line @next/next/no-img-element -- local/proxied source, painted over */}
        <img
          ref={imgRef}
          src={src}
          alt="Base image"
          onLoad={syncCanvasToImage}
          className="block w-full select-none"
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerLeave={endStroke}
          onPointerCancel={endStroke}
          className="absolute inset-0 h-full w-full touch-none cursor-crosshair"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 min-w-[10rem] items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-1.5">
          <Paintbrush className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="range"
            min={8}
            max={256}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="flex-1 accent-primary"
            aria-label="Brush size"
          />
          <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{brushSize}</span>
        </div>

        <button
          type="button"
          onClick={() => setErase((v) => !v)}
          aria-pressed={erase}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
            erase ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border bg-background hover:bg-muted/50'
          }`}
        >
          <Eraser className="h-4 w-4" /> Erase
        </button>

        <button
          type="button"
          onClick={() => setInvert((v) => !v)}
          aria-pressed={invert}
          title="Swap masked area — paint the part to keep instead"
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
            invert ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border bg-background hover:bg-muted/50'
          }`}
        >
          <FlipHorizontal2 className="h-4 w-4" /> Invert
        </button>

        <button
          type="button"
          onClick={clear}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted/50"
        >
          <RotateCcw className="h-4 w-4" /> Clear
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Paint over the area to regenerate. {invert && 'Inverted: painted area is kept, the rest is redrawn.'}
      </p>
    </div>
  )
})

export default MaskBrush
