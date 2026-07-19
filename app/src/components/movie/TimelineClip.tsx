'use client'

import { clipDuration } from '@/lib/movies/timeline-core'
import { cn } from '@/lib/utils'
import type { MovieAsset, MovieClip, TrackKind } from '@/types/movie'
import { useEditorStore } from './editor-store'
import { selectZoom } from './editor-selectors'
import { useEditorActions } from './editor-actions'
import { useTimelineDrag } from './useTimelineDrag'

export default function TimelineClip({
  clip,
  asset,
  trackKind,
}: {
  clip: MovieClip
  asset: MovieAsset | undefined
  trackKind: TrackKind
}) {
  const zoom = useEditorStore(selectZoom)
  const selected = useEditorStore((s) => s.session.selectedClipIds.includes(clip.id))
  const actions = useEditorActions()
  const drag = useTimelineDrag(clip.id)

  const offline = !asset || asset.offline
  const fade = clip.crossfadeWithPrevious ?? 0

  return (
    <div
      data-movie-clip={clip.id}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel}
      onClick={(e) => {
        e.stopPropagation()
        if (drag.consumeClickSuppression()) return
        actions.selectClips([clip.id])
      }}
      className={cn(
        'absolute top-1.5 bottom-1.5 rounded-md border text-[10px] select-none touch-none overflow-hidden',
        'cursor-grab active:cursor-grabbing',
        trackKind === 'audio'
          ? 'bg-emerald-500/20 border-emerald-500/40'
          : 'bg-primary/20 border-primary/40',
        offline && 'bg-destructive/20 border-destructive/60',
        selected && 'ring-2 ring-primary',
        '[&.movie-clip-invalid]:ring-2 [&.movie-clip-invalid]:ring-destructive',
      )}
      style={{ left: clip.startSec * zoom, width: clipDuration(clip) * zoom }}
    >
      {fade > 0 && (
        <div
          className="absolute inset-y-0 left-0 bg-linear-to-r from-background/80 to-transparent pointer-events-none"
          style={{ width: fade * zoom }}
        />
      )}
      <p className={cn('px-1.5 py-1 truncate', offline && 'line-through text-destructive')}>
        {asset?.filename ?? 'Missing asset'}
      </p>
      <div data-trim-handle="start" className="absolute inset-y-0 left-0 w-2 cursor-ew-resize" />
      <div data-trim-handle="end" className="absolute inset-y-0 right-0 w-2 cursor-ew-resize" />
    </div>
  )
}
