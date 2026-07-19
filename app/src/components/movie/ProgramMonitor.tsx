'use client'

import { Fragment, useMemo } from 'react'
import { Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MovieAsset } from '@/types/movie'
import { useEditorStore } from './editor-store'
import { selectAssets, selectIsPlaying, selectSettings, selectTracks } from './editor-selectors'
import { useEditorActions } from './editor-actions'
import { mediaUrl, usePlaybackEngine } from './usePlaybackEngine'

export default function ProgramMonitor() {
  const settings = useEditorStore(selectSettings)
  const tracks = useEditorStore(selectTracks)
  const assets = useEditorStore(selectAssets)
  const isPlaying = useEditorStore(selectIsPlaying)
  const actions = useEditorActions()
  const engine = usePlaybackEngine()

  const assetById = useMemo(() => new Map<string, MovieAsset>(assets.map((a) => [a.id, a])), [assets])
  const videoTracks = tracks.filter((t) => t.kind === 'video')
  const audioTrackClips = tracks
    .filter((t) => t.kind === 'audio')
    .flatMap((t) => t.clips)
    .filter((c) => {
      const a = assetById.get(c.assetId)
      return a && !a.offline && a.kind !== 'image'
    })

  return (
    <div className="flex flex-col h-full w-full">
      {/* Stage */}
      <div className="flex-1 min-h-0 relative bg-black overflow-hidden">
        {videoTracks.map((track) => (
          <Fragment key={track.id}>
            {(['a', 'b'] as const).map((slot) => (
              <video
                key={slot}
                playsInline
                preload="auto"
                className="absolute inset-0 w-full h-full object-contain opacity-0"
                ref={(el) => { engine.registerVideoSlot(track.id, slot, el) }}
              />
            ))}
            {track.clips.map((clip) => {
              const asset = assetById.get(clip.assetId)
              if (!asset || asset.kind !== 'image' || asset.offline) return null
              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={clip.id}
                  alt={asset.filename}
                  src={mediaUrl(asset)}
                  className="absolute inset-0 w-full h-full object-contain opacity-0"
                  ref={(el) => { engine.registerImage(clip.id, el) }}
                />
              )
            })}
          </Fragment>
        ))}
        {audioTrackClips.map((clip) => {
          const asset = assetById.get(clip.assetId)!
          return (
            <audio
              key={clip.id}
              preload="auto"
              src={mediaUrl(asset)}
              ref={(el) => { engine.registerAudio(clip.id, el) }}
            />
          )
        })}
      </div>

      {/* Transport */}
      <div className="flex items-center gap-3 px-3 py-2 border-t border-border bg-card/60 shrink-0">
        <Button
          variant="ghost"
          size="icon-lg"
          onClick={() => actions.setIsPlaying(!isPlaying)}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause /> : <Play />}
        </Button>
        <span
          data-movie-clock
          className="text-xs text-muted-foreground tabular-nums"
          ref={(el) => { engine.registerClock(el) }}
        >
          0:00.0 / 0:00.0
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {settings.width}×{settings.height} @ {settings.fps} fps
        </span>
      </div>
    </div>
  )
}
