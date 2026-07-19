'use client'

import { useEffect } from 'react'
import { ImageIcon } from 'lucide-react'
import { useQueueStore } from '@/lib/comfyui/queue'
import { useStudioStore } from '@/lib/generation/studio-store'
import { useRecentImagesStore } from '@/lib/generation/recent-store'

/**
 * Right-side rail of the latest generated images, sourced from the on-disk
 * gallery so it persists across reloads and shows results from every session.
 * Always visible; clicking a thumbnail opens the inspector modal.
 */
export default function RecentRail() {
  const images = useRecentImagesStore((s) => s.images)
  const loadedOnce = useRecentImagesStore((s) => s.loadedOnce)
  const refresh = useRecentImagesStore((s) => s.refresh)
  const inspectImageUrl = useStudioStore((s) => s.inspectImageUrl)
  const setInspectImage = useStudioStore((s) => s.setInspectImage)
  // Re-scan the gallery whenever a generation finishes so the new file shows up.
  const doneCount = useQueueStore((s) => s.jobs.filter((j) => j.status === 'done').length)

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

      {images.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
          <ImageIcon className="h-7 w-7 opacity-40" />
          <p className="text-xs">{loadedOnce ? 'No images yet' : 'Loading…'}</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
          {images.map((img) => (
            <button
              key={img.id}
              onClick={() => setInspectImage(img.url)}
              className={`relative aspect-square w-full shrink-0 overflow-hidden rounded-lg transition-all duration-200 ${
                inspectImageUrl === img.url
                  ? 'ring-2 ring-primary shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_18%,transparent)]'
                  : 'ring-1 ring-border hover:ring-primary/40'
              }`}
              title="Inspect image"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local gallery image */}
              <img src={img.thumbnailUrl || img.url} alt="Recent generation" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}
