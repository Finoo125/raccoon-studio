'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { renderToCanvas } from '@/lib/photo-edit/pipeline'
import { defaultEditState, type EditState } from '@/lib/photo-edit/types'
import SliceOverlay from './SliceOverlay'

// Maximum size (px) for the preview downscale on the longest side.
const MAX_PREVIEW_PX = 1600

/** Compute scaled dimensions so the longest side does not exceed maxPx. */
function scaledDims(
  w: number,
  h: number,
  maxPx: number,
): { rw: number; rh: number } {
  if (w <= maxPx && h <= maxPx) return { rw: w, rh: h }
  const scale = maxPx / Math.max(w, h)
  return { rw: Math.round(w * scale), rh: Math.round(h * scale) }
}

/**
 * EditorCanvas — canvas + zoom/pan/compare.
 *
 * Responsibilities:
 *  - Downscale `source` to a preview bitmap (≤1600px longest side) once per image load.
 *  - Re-render via rAF on editState change (preview only; Task 11 will export full-res).
 *  - Zoom (mouse wheel) + pan (pointer drag) via CSS transform — no pixel re-render.
 *  - Hold-to-compare: a dedicated "Compare" button; hold it to preview the original
 *    (defaultEditState()), release to restore the edited state.
 */
export default function EditorCanvas() {
  const source = usePhotoEditStore((s) => s.source)
  const editState = usePhotoEditStore((s) => s.editState)
  const activeTool = usePhotoEditStore((s) => s.activeTool)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // The downscaled preview bitmap — we own its lifecycle (.close() when replaced).
  const previewBitmapRef = useRef<ImageBitmap | null>(null)
  // Mirror of editState accessible to rAF callbacks without stale closures.
  const editStateRef = useRef<EditState>(editState)
  // True while the compare button is held.
  const comparingRef = useRef(false)
  // Pending rAF handle.
  const rafRef = useRef<number | null>(null)

  // Zoom + pan (CSS transform only — no canvas re-render).
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  // Active pan drag state.
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)

  // ── Sync editStateRef BEFORE paint (layoutEffect) ───────────────────────────
  // useLayoutEffect runs synchronously after DOM mutations but before paint,
  // so the rAF callback scheduled in the effect below will read the updated ref.
  useLayoutEffect(() => {
    editStateRef.current = editState
  }, [editState])

  // ── Schedule a canvas render ─────────────────────────────────────────────────
  function scheduleRender() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const canvas = canvasRef.current
      const bmp = previewBitmapRef.current
      if (!canvas || !bmp) return
      const state = comparingRef.current ? defaultEditState() : editStateRef.current
      renderToCanvas(bmp, state, canvas)
    })
  }

  // ── Build preview bitmap when source changes ─────────────────────────────────
  useEffect(() => {
    if (!source) {
      if (previewBitmapRef.current) {
        previewBitmapRef.current.close()
        previewBitmapRef.current = null
      }
      return
    }

    let cancelled = false
    const { rw, rh } = scaledDims(source.width, source.height, MAX_PREVIEW_PX)

    void createImageBitmap(source, {
      resizeWidth: rw,
      resizeHeight: rh,
      resizeQuality: 'high',
    }).then((bmp) => {
      if (cancelled) { bmp.close(); return }
      if (previewBitmapRef.current) previewBitmapRef.current.close()
      previewBitmapRef.current = bmp
      // Reset zoom/pan when a new image loads.
      setZoom(1)
      setPan({ x: 0, y: 0 })
      scheduleRender()
    })

    return () => { cancelled = true }
  }, [source])

  // ── Re-render on editState changes ──────────────────────────────────────────
  useEffect(() => {
    scheduleRender()
  }, [editState])

  // ── Cleanup on unmount ───────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      if (previewBitmapRef.current) {
        previewBitmapRef.current.close()
        previewBitmapRef.current = null
      }
    }
  }, [])

  // ── Zoom via mouse wheel (native listener: React onWheel is passive) ─────────
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      setZoom((z) => Math.min(8, Math.max(0.1, z * delta)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── Pan via pointer drag ─────────────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('[data-compare-btn]')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy })
  }

  const handlePointerUp = () => { dragRef.current = null }

  // ── Hold-to-compare handlers ─────────────────────────────────────────────────
  const handleCompareDown = () => {
    comparingRef.current = true
    scheduleRender()
  }
  const handleCompareUp = () => {
    comparingRef.current = false
    scheduleRender()
  }

  return (
    <div
      ref={wrapperRef}
      className="relative flex h-full w-full cursor-grab select-none items-center justify-center overflow-hidden bg-background active:cursor-grabbing"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Subtle canvas-board tint while an image is loaded */}
      {source && (
        <div className="pointer-events-none absolute inset-0 canvas-board opacity-40" />
      )}

      {/* Canvas wrapper — receives CSS zoom+pan transform */}
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
          willChange: 'transform',
        }}
      >
        <div className="relative">
          <canvas
            ref={canvasRef}
            className="block max-w-none rounded shadow-xl"
          />
          {source && activeTool === 'slice' && <SliceOverlay />}
        </div>
      </div>

      {/* Empty state (no source loaded yet) */}
      {!source && (
        <div className="pointer-events-none z-10 flex flex-col items-center gap-2 text-center text-muted-foreground">
          <p className="text-sm">No image loaded</p>
        </div>
      )}

      {/* Compare button — hold to preview original (before edits) */}
      {source && (
        <button
          type="button"
          data-compare-btn=""
          onPointerDown={handleCompareDown}
          onPointerUp={handleCompareUp}
          onPointerLeave={handleCompareUp}
          onPointerCancel={handleCompareUp}
          title="Hold to compare with original"
          className="absolute bottom-4 right-4 z-10 rounded-md border border-border bg-card/80 px-3 py-1.5 text-xs font-medium text-foreground backdrop-blur-sm transition-colors hover:bg-card active:bg-primary/10"
        >
          Compare
        </button>
      )}

      {/* Zoom indicator — shown whenever zoom deviates from 100% */}
      {source && zoom !== 1 && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-md border border-border bg-card/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm">
          {Math.round(zoom * 100)}%
        </div>
      )}
    </div>
  )
}
