'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { timelineDuration } from '@/lib/movies/timeline-core'
import type { MovieAsset, MovieTrack } from '@/types/movie'
import { useEditorStore, useEditorStoreApi } from './editor-store'
import { selectAssets, selectTracks, selectZoom } from './editor-selectors'
import { useEditorActions } from './editor-actions'
import TimelineClip from './TimelineClip'

const ROW_H = 56
const RULER_H = 36
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60]

const DND_ASSET = 'application/x-raccoon-asset'
const DND_GALLERY = 'application/x-raccoon-gallery'

interface DisplayTrack {
  track: MovieTrack
  label: string
}

function formatTick(sec: number, step: number): string {
  if (step < 1) return sec.toFixed(1)
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function Timeline({ projectId }: { projectId: string }) {
  const tracks = useEditorStore(selectTracks)
  const assets = useEditorStore(selectAssets)
  const zoom = useEditorStore(selectZoom)
  const actions = useEditorActions()
  const api = useEditorStoreApi()
  const scrollRef = useRef<HTMLDivElement>(null)

  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets])

  // Video tracks render top-down in reverse array order (top = overlay), then audio
  const displayTracks = useMemo<DisplayTrack[]>(() => {
    const videos = tracks.filter((t) => t.kind === 'video')
    const audios = tracks.filter((t) => t.kind === 'audio')
    return [
      ...videos.map((track, i) => ({ track, label: `V${i + 1}` })).reverse(),
      ...audios.map((track, i) => ({ track, label: `A${i + 1}` })),
    ]
  }, [tracks])

  const durationSec = timelineDuration(tracks)
  const contentWidth = Math.max(durationSec, 60) * zoom + 200
  const contentSec = contentWidth / zoom

  const tickStep = TICK_STEPS.find((s) => s * zoom >= 70) ?? 60
  const ticks = useMemo(() => {
    const out: number[] = []
    for (let t = 0; t <= contentSec; t += tickStep) out.push(Number(t.toFixed(3)))
    return out
  }, [contentSec, tickStep])

  // Ctrl+wheel zooms around the cursor (native listener: React wheel is passive)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const { zoom: z } = api.getState().session
      const next = Math.min(400, Math.max(8, z * (e.deltaY < 0 ? 1.2 : 1 / 1.2)))
      if (next === z) return
      const cursorX = e.clientX - el.getBoundingClientRect().left
      const timeAtCursor = (el.scrollLeft + cursorX) / z
      actions.setZoom(next)
      el.scrollLeft = timeAtCursor * next - cursorX
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [api, actions])

  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    actions.setPlayhead(Math.max(0, (e.clientX - rect.left) / zoom))
  }

  const laneSec = (e: React.DragEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return Math.max(0, (e.clientX - rect.left) / zoom)
  }

  const dropOnLane = async (e: React.DragEvent<HTMLDivElement>, trackId: string) => {
    e.preventDefault()
    const sec = laneSec(e)
    const assetData = e.dataTransfer.getData(DND_ASSET)
    if (assetData) {
      const { assetId } = JSON.parse(assetData) as { assetId: string }
      if (!actions.addClipFromAsset(assetId, trackId, sec)) {
        toast.error('Cannot place this asset here')
      }
      return
    }
    const galleryData = e.dataTransfer.getData(DND_GALLERY)
    if (!galleryData) return
    const { path } = JSON.parse(galleryData) as { path: string }
    try {
      const res = await fetch(`/api/movies/${projectId}/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      if (!res.ok) throw new Error()
      const { asset } = (await res.json()) as { asset: MovieAsset }
      actions.addAsset(asset)
      // addAsset dedupes by path; resolve to the stored asset
      const stored = api.getState().editorModel.assets.find((a) => a.path === asset.path)
      if (!stored || !actions.addClipFromAsset(stored.id, trackId, sec)) {
        toast.error('Cannot place this asset here')
      }
    } catch {
      toast.error('Failed to import gallery video')
    }
  }

  return (
    <div className="flex h-full">
      {/* Gutter: zoom controls + track labels */}
      <div className="w-14 shrink-0 border-r border-border flex flex-col">
        <div className="flex items-center justify-center gap-0.5 border-b border-border" style={{ height: RULER_H }}>
          <Button variant="ghost" size="icon" onClick={() => actions.setZoom(zoom / 1.5)} aria-label="Zoom out">
            <Minus />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => actions.setZoom(zoom * 1.5)} aria-label="Zoom in">
            <Plus />
          </Button>
        </div>
        {displayTracks.map(({ track, label }) => (
          <div
            key={track.id}
            className="flex items-center justify-center text-[10px] font-medium text-muted-foreground border-b border-border/50"
            style={{ height: ROW_H }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Scrollable content */}
      <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto">
        <div className="relative" style={{ width: contentWidth }}>
          {/* Ruler */}
          <div
            data-movie-ruler
            className="relative border-b border-border cursor-col-resize select-none touch-none"
            style={{ height: RULER_H }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              scrub(e)
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e)
            }}
          >
            {ticks.map((t) => (
              <div key={t} className="absolute top-0 bottom-0" style={{ left: t * zoom }}>
                <div className="w-px h-full bg-border" />
                <span className="absolute top-0.5 left-1 text-[9px] text-muted-foreground tabular-nums">
                  {formatTick(t, tickStep)}
                </span>
              </div>
            ))}
          </div>

          {/* Track lanes */}
          {displayTracks.map(({ track }) => (
            <div
              key={track.id}
              data-movie-lane={track.kind}
              className="relative border-b border-border/50 bg-background/30"
              style={{ height: ROW_H }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(DND_ASSET) || e.dataTransfer.types.includes(DND_GALLERY)) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                }
              }}
              onDrop={(e) => void dropOnLane(e, track.id)}
              onClick={(e) => {
                if (e.target !== e.currentTarget) return
                actions.setPlayhead(laneSec(e))
                actions.selectClips([])
              }}
            >
              {track.clips.map((clip) => (
                <TimelineClip
                  key={clip.id}
                  clip={clip}
                  asset={assetById.get(clip.assetId)}
                  trackKind={track.kind}
                />
              ))}
            </div>
          ))}

          <PlayheadLine />
        </div>
      </div>
    </div>
  )
}

/**
 * Store-driven playhead line. The playback engine also moves this element
 * directly each frame via the data-movie-playhead transform, so playback
 * stays smooth without store churn.
 */
function PlayheadLine() {
  const playheadSec = useEditorStore((s) => s.session.playheadSec)
  const zoom = useEditorStore(selectZoom)
  return (
    <div
      data-movie-playhead
      className="absolute top-0 bottom-0 left-0 z-20 pointer-events-none"
      style={{ transform: `translateX(${playheadSec * zoom}px)` }}
    >
      <div className="absolute top-0 bottom-0 w-px bg-red-500" />
      <div className="absolute top-0 -left-[5px] border-x-[5px] border-t-[6px] border-x-transparent border-t-red-500" />
    </div>
  )
}
