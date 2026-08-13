'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { placement, renderToCanvas } from '@/lib/photo-edit/pipeline'
import { computeHistogram } from '@/lib/photo-edit/histogram'
import { defaultEditState, type EditState } from '@/lib/photo-edit/types'
import SliceOverlay from './SliceOverlay'
import CropHandles from './CropHandles'
import MaskOverlay from './MaskOverlay'

// Maximum size (px) for the preview downscale on the longest side.
const MAX_PREVIEW_PX = 1600
// Draft size used while a slider is being dragged. A full-featured edit costs
// ~500 ms at preview size, which is four unusable frames a second; a quarter of
// the pixels is four times the frame rate, and the full render lands on release.
//
// ponytail: the real fix is an OffscreenCanvas in a worker — the pipeline is
// already a pure function over ImageLike, so nothing here would have to change.
// Do that when a soft drag preview stops being good enough.
const MAX_DRAFT_PX = 800

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
  const canvasMode = usePhotoEditStore((s) => s.canvasMode)
  const comparing = usePhotoEditStore((s) => s.comparing)
  const setComparing = usePhotoEditStore((s) => s.setComparing)
  const setHistogram = usePhotoEditStore((s) => s.setHistogram)
  const setCanvasAspect = usePhotoEditStore((s) => s.setCanvasAspect)
  // Non-null exactly while a drag is in flight — the same signal the history uses
  // to coalesce, reused here to pick the draft bitmap.
  const dragging = usePhotoEditStore((s) => s.coalesceKey !== null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // The downscaled preview bitmap — we own its lifecycle (.close() when replaced).
  const previewBitmapRef = useRef<ImageBitmap | null>(null)
  // Quarter-area version of the same, rendered while dragging.
  const draftBitmapRef = useRef<ImageBitmap | null>(null)
  const draggingRef = useRef(dragging)
  // CSS size of the canvas. Pinned to the full-resolution result so the image
  // does not visibly resize when a drag swaps in the smaller backing store.
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number } | null>(null)
  // Mirror of editState accessible to rAF callbacks without stale closures.
  const editStateRef = useRef<EditState>(editState)
  // Same, for the canvas mode — crop mode renders the image uncropped.
  const canvasModeRef = useRef(canvasMode)
  // True while compare is held — from the button or the \ key, hence the store.
  const comparingRef = useRef(comparing)
  // Pending rAF handle.
  const rafRef = useRef<number | null>(null)
  // Trailing timer that re-renders at full resolution once edits stop arriving.
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Zoom + pan (CSS transform only — no canvas re-render).
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  // Once the user has zoomed by hand, stop re-fitting under them.
  const userZoomedRef = useRef(false)
  // Active pan drag state.
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)

  // ── Sync editStateRef BEFORE paint (layoutEffect) ───────────────────────────
  // useLayoutEffect runs synchronously after DOM mutations but before paint,
  // so the rAF callback scheduled in the effect below will read the updated ref.
  useLayoutEffect(() => {
    editStateRef.current = editState
    canvasModeRef.current = canvasMode
    draggingRef.current = dragging
    comparingRef.current = comparing
  }, [editState, canvasMode, dragging, comparing])

  // ── Schedule a canvas render ─────────────────────────────────────────────────
  function scheduleRender(force = false) {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    if (settleRef.current) clearTimeout(settleRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const canvas = canvasRef.current
      const full = previewBitmapRef.current
      if (!canvas || !full) return
      let state = comparingRef.current ? defaultEditState() : editStateRef.current
      // While cropping, show the whole frame so the handles have somewhere to
      // drag outward into — CropHandles draws the crop rect over the top.
      if (canvasModeRef.current === 'crop') state = { ...state, crop: null }

      const draft = force || !draggingRef.current ? null : draftBitmapRef.current
      renderToCanvas(draft ?? full, state, canvas)

      // Always settle at full resolution. Dragging a slider clears the gesture on
      // pointer-up, but a discrete control that coalesces — Rotate 90°, an aspect
      // preset, a mask toggle — has no release to hook, and without this trailing
      // pass the preview would sit at draft resolution until something else moved.
      if (draft) settleRef.current = setTimeout(() => scheduleRender(true), 180)

      // Hold the layout at full-resolution dimensions whichever bitmap was used.
      const p = placement(full.width, full.height, state)
      setDisplaySize((prev) => (prev?.w === p.cw && prev?.h === p.ch ? prev : { w: p.cw, h: p.ch }))
      setCanvasAspect(p.cw / p.ch)

      // The histogram describes the finished frame, so it is only meaningful off
      // the full render — a draft would make it twitch on every drag tick.
      if (!draft) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          const id = ctx.getImageData(0, 0, canvas.width, canvas.height)
          setHistogram(computeHistogram({ data: id.data, width: id.width, height: id.height }))
        }
      }
    })
  }

  // ── Build preview bitmap when source changes ─────────────────────────────────
  useEffect(() => {
    const closeBoth = () => {
      previewBitmapRef.current?.close()
      draftBitmapRef.current?.close()
      previewBitmapRef.current = null
      draftBitmapRef.current = null
    }
    if (!source) { closeBoth(); return }

    let cancelled = false
    const full = scaledDims(source.width, source.height, MAX_PREVIEW_PX)
    const draft = scaledDims(source.width, source.height, MAX_DRAFT_PX)

    void Promise.all([
      createImageBitmap(source, { resizeWidth: full.rw, resizeHeight: full.rh, resizeQuality: 'high' }),
      createImageBitmap(source, { resizeWidth: draft.rw, resizeHeight: draft.rh, resizeQuality: 'medium' }),
    ]).then(([fullBmp, draftBmp]) => {
      if (cancelled) { fullBmp.close(); draftBmp.close(); return }
      closeBoth()
      previewBitmapRef.current = fullBmp
      draftBitmapRef.current = draftBmp
      // A new image gets a fresh fit, whatever the last one was zoomed to.
      userZoomedRef.current = false
      setPan({ x: 0, y: 0 })
      scheduleRender()
    })

    return () => { cancelled = true }
  }, [source])

  // ── Re-render on editState / tool changes ───────────────────────────────────
  useEffect(() => {
    scheduleRender()
  }, [editState, canvasMode, dragging, comparing])

  // ── Cleanup on unmount ───────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      if (settleRef.current) clearTimeout(settleRef.current)
      previewBitmapRef.current?.close()
      draftBitmapRef.current?.close()
      previewBitmapRef.current = null
      draftBitmapRef.current = null
    }
  }, [])

  // ── Fit to window ────────────────────────────────────────────────────────────
  // The canvas is sized in image pixels, so a 832×1216 render overflows the
  // viewport at 100%. Fit on load and whenever the output dimensions change
  // (a crop, a rotate) — but never after the user has set their own zoom.
  function fitZoom(): number {
    const el = wrapperRef.current
    if (!el || !displaySize) return 1
    const pad = 48
    return Math.min(1, (el.clientWidth - pad) / displaySize.w, (el.clientHeight - pad) / displaySize.h)
  }

  useEffect(() => {
    if (!displaySize || userZoomedRef.current) return
    setZoom(fitZoom())
    setPan({ x: 0, y: 0 })
    // fitZoom reads the container element and displaySize, which is the dep here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displaySize])

  const resetFit = () => {
    userZoomedRef.current = false
    setZoom(fitZoom())
    setPan({ x: 0, y: 0 })
  }

  // ── Zoom via mouse wheel (native listener: React onWheel is passive) ─────────
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      userZoomedRef.current = true
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      setZoom((z) => Math.min(8, Math.max(0.1, z * delta)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── Zoom shortcuts ───────────────────────────────────────────────────────────
  // Kept here rather than with the rest of the shortcuts because zoom is this
  // component's own state; routing it through the store would buy nothing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === '0') { e.preventDefault(); resetFit() }
      if (e.key === '1') { e.preventDefault(); userZoomedRef.current = true; setZoom(1); setPan({ x: 0, y: 0 }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── Pan via pointer drag ─────────────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('[data-compare-btn]') || target.closest('[data-zoom-btn]')) return
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
  const handleCompareDown = () => setComparing(true)
  const handleCompareUp = () => setComparing(false)

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
          // Overlays live inside this transform, so anything that must stay a
          // fixed on-screen size (a text tag) counter-scales by this.
          '--pe-zoom': zoom,
        } as React.CSSProperties}
      >
        <div className="relative">
          <canvas
            ref={canvasRef}
            className="block max-w-none rounded shadow-xl"
            style={displaySize ? { width: displaySize.w, height: displaySize.h } : undefined}
          />
          {source && canvasMode === 'slice' && <SliceOverlay />}
          {source && canvasMode === 'crop' && <CropHandles />}
          {source && canvasMode === 'masks' && <MaskOverlay />}
        </div>
      </div>

      {/* Empty state (no source loaded yet) */}
      {!source && (
        <div className="pointer-events-none z-10 flex flex-col items-center gap-2 text-center text-muted-foreground">
          <p className="text-sm">No image loaded</p>
        </div>
      )}

      {/* Output size while cropping. Read straight off `placement`, the same
          function that sizes the export canvas, so the number cannot drift from
          what you actually get. Outside the zoom transform, so it stays legible. */}
      {source && canvasMode === 'crop' && (
        <div
          data-crop-size=""
          className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-md border border-border bg-card/80 px-2.5 py-1 text-xs font-medium tabular-nums text-foreground backdrop-blur-sm"
        >
          {(() => {
            const p = placement(source.width, source.height, editState)
            return `${p.cw} × ${p.ch} px`
          })()}
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
          title="Hold to compare with original (\)"
          className="absolute bottom-4 right-4 z-10 rounded-md border border-border bg-card/80 px-3 py-1.5 text-xs font-medium text-foreground backdrop-blur-sm transition-colors hover:bg-card active:bg-primary/10"
        >
          Compare
        </button>
      )}

      {/* Zoom readout — click to re-fit, or jump to 100% when already fitted */}
      {source && (
        <button
          type="button"
          data-zoom-btn=""
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            if (Math.abs(zoom - 1) < 0.001) { resetFit(); return }
            userZoomedRef.current = true
            setZoom(1)
            setPan({ x: 0, y: 0 })
          }}
          title={Math.abs(zoom - 1) < 0.001 ? 'Fit to window (0)' : 'Zoom to 100% (1)'}
          className="absolute bottom-4 left-4 z-10 rounded-md border border-border bg-card/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm transition-colors hover:text-foreground"
        >
          {Math.round(zoom * 100)}%
        </button>
      )}
    </div>
  )
}
