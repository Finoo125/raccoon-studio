'use client'

import { useEffect } from 'react'
import { Clapperboard } from 'lucide-react'
import { useQueueStore } from '@/lib/comfyui/queue'
import { useStudioStore } from '@/lib/generation/studio-store'
import { useRecentVideosStore } from '@/lib/generation/recent-videos-store'

/**
 * Right-side rail of the latest rendered videos, sourced from the on-disk gallery
 * so it persists across reloads and shows results from every session. Always
 * visible; clicking a thumbnail opens the centered video inspector modal.
 */
export default function RecentVideoRail() {
  const videos = useRecentVideosStore((s) => s.videos)
  const loadedOnce = useRecentVideosStore((s) => s.loadedOnce)
  const refresh = useRecentVideosStore((s) => s.refresh)
  const inspectVideoUrl = useStudioStore((s) => s.inspectVideoUrl)
  const setInspectVideo = useStudioStore((s) => s.setInspectVideo)
  // Re-scan the gallery whenever a video generation finishes so the new clip shows up.
  const doneCount = useQueueStore((s) => s.jobs.filter((j) => j.kind === 'video' && j.status === 'done').length)

  useEffect(() => {
    void refresh(doneCount > 0)
  }, [doneCount, refresh])

  return (
    <aside className="w-96 shrink-0 border-l border-border bg-card/30 flex flex-col">
      <div className="px-4 py-3 border-b border-border/60 select-none">
        <span className="font-heading text-base font-semibold uppercase tracking-wider text-foreground">
          Recent
        </span>
      </div>

      {videos.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
          <Clapperboard className="h-7 w-7 opacity-40" />
          <p className="text-xs">{loadedOnce ? 'No videos yet' : 'Loading…'}</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
          {videos.map((vid) => (
            <button
              key={vid.id}
              onClick={() => setInspectVideo(vid.url)}
              className={`relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-muted transition-all duration-200 ${
                inspectVideoUrl === vid.url
                  ? 'ring-2 ring-primary shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_18%,transparent)]'
                  : 'ring-1 ring-border hover:ring-primary/40'
              }`}
              title="Inspect video"
            >
              {/* First-frame poster via #t — preload metadata only, no streaming. */}
              <video
                src={`${vid.url}#t=0.1`}
                muted
                playsInline
                preload="metadata"
                className="h-full w-full object-cover pointer-events-none"
              />
              <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded bg-black/60 p-1 text-white">
                <Clapperboard className="h-3 w-3" />
              </span>
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}
