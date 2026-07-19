'use client'

import { useRef } from 'react'
import {
  clipDuration, clipEnd, resolveMove, resolveTrim, snapTargets, sortClips,
} from '@/lib/movies/timeline-core'
import type { MovieClip } from '@/types/movie'
import { useEditorStoreApi } from './editor-store'
import { useEditorActions } from './editor-actions'

const SNAP_PX = 8
type DragMode = 'move' | 'trim-start' | 'trim-end'

interface DragState {
  mode: DragMode
  pointerId: number
  startClientX: number
  clip: MovieClip
  moved: boolean
}

/**
 * Pointer-event drag for a timeline clip. Mutates the element's inline
 * left/width during the drag (no store writes) and commits via
 * moveClip/trimClip on release; inline styles are cleared afterwards so the
 * committed store state wins (or the old position is restored on rejection).
 */
export function useTimelineDrag(clipId: string) {
  const api = useEditorStoreApi()
  const actions = useEditorActions()
  const dragRef = useRef<DragState | null>(null)
  const suppressClickRef = useRef(false)

  const findContext = () => {
    const model = api.getState().editorModel
    const track = model.tracks.find((t) => t.clips.some((c) => c.id === clipId))
    if (!track) return null
    const clip = track.clips.find((c) => c.id === clipId)!
    const asset = model.assets.find((a) => a.id === clip.assetId)
    return { model, track, clip, asset }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const ctx = findContext()
    if (!ctx) return
    const handle = (e.target as HTMLElement).dataset.trimHandle
    dragRef.current = {
      mode: handle === 'start' ? 'trim-start' : handle === 'end' ? 'trim-end' : 'move',
      pointerId: e.pointerId,
      startClientX: e.clientX,
      clip: ctx.clip,
      moved: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    const ctx = findContext()
    if (!ctx) return
    const { session } = api.getState()
    const zoom = session.zoom
    const dSec = (e.clientX - drag.startClientX) / zoom
    if (!drag.moved && Math.abs(e.clientX - drag.startClientX) < 3) return
    drag.moved = true

    const el = e.currentTarget
    if (drag.mode === 'move') {
      const desired = drag.clip.startSec + dSec
      const targets = session.snapping
        ? snapTargets(ctx.model.tracks, clipId, session.playheadSec)
        : []
      const resolved = resolveMove(ctx.track.clips, clipId, desired, targets, SNAP_PX / zoom)
      el.style.left = `${Math.max(0, resolved ?? desired) * zoom}px`
      el.classList.toggle('movie-clip-invalid', resolved === null)
      return
    }

    const sorted = sortClips(ctx.track.clips)
    const idx = sorted.findIndex((c) => c.id === clipId)
    const prevEnd = idx > 0 ? clipEnd(sorted[idx - 1]) : 0
    const nextStart = sorted[idx + 1]?.startSec ?? Infinity
    const assetDur = !ctx.asset || ctx.asset.kind === 'image' ? Infinity : ctx.asset.durationSec
    const edge = drag.mode === 'trim-start' ? 'start' : 'end'
    const desired = edge === 'start'
      ? drag.clip.startSec + dSec
      : clipEnd(drag.clip) + dSec
    const r = resolveTrim(drag.clip, assetDur, edge, desired, prevEnd, nextStart)
    el.style.left = `${r.startSec * zoom}px`
    el.style.width = `${(r.outSec - r.inSec) * zoom}px`
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    const drag = dragRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    dragRef.current = null
    const el = e.currentTarget
    el.classList.remove('movie-clip-invalid')
    if (drag.moved) {
      suppressClickRef.current = true
      if (commit) {
        const zoom = api.getState().session.zoom
        const dSec = (e.clientX - drag.startClientX) / zoom
        if (drag.mode === 'move') {
          actions.moveClip(clipId, drag.clip.startSec + dSec)
        } else if (drag.mode === 'trim-start') {
          actions.trimClip(clipId, 'start', drag.clip.startSec + dSec)
        } else {
          actions.trimClip(clipId, 'end', clipEnd(drag.clip) + dSec)
        }
      }
    }
    // React re-renders the committed result; clearing restores rejected drags too
    el.style.left = `${api.getState().session.zoom * 0}px`
    const ctx = findContext()
    if (ctx) {
      const zoom = api.getState().session.zoom
      el.style.left = `${ctx.clip.startSec * zoom}px`
      el.style.width = `${clipDuration(ctx.clip) * zoom}px`
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => endDrag(e, true)
  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => endDrag(e, false)

  /** True once after a drag, to suppress the click that follows pointerup. */
  const consumeClickSuppression = () => {
    const v = suppressClickRef.current
    suppressClickRef.current = false
    return v
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, consumeClickSuppression }
}
