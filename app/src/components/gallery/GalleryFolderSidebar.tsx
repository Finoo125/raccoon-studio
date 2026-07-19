'use client'

import { useEffect, useMemo } from 'react'
import { Images } from 'lucide-react'
import { useGalleryStore } from '@/lib/gallery/store'
import { buildFolders } from '@/lib/gallery/folders'

export default function GalleryFolderSidebar() {
  const { images, selectedFolder, setSelectedFolder, sidebarCollapsed, mediaMode } = useGalleryStore()

  const folders = useMemo(() => buildFolders(images), [images])

  // If the browsed folder is no longer present (e.g. a filter change emptied
  // it), fall back to "All images" so the grid is never mysteriously empty.
  useEffect(() => {
    if (selectedFolder && !folders.some((f) => f.key === selectedFolder)) {
      setSelectedFolder(null)
    }
  }, [folders, selectedFolder, setSelectedFolder])

  if (sidebarCollapsed) return null

  return (
    <aside className="w-60 shrink-0 border-r border-border bg-card/40 overflow-y-auto">
      <div className="px-3 py-3">
        <h2 className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Folders
        </h2>

        {/* All images */}
        <button
          onClick={() => setSelectedFolder(null)}
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors ${
            selectedFolder === null
              ? 'bg-primary/10 text-foreground ring-1 ring-primary/30'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          }`}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted ring-1 ring-border">
            <Images className="h-4 w-4 text-muted-foreground" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {mediaMode === 'video' ? 'All videos' : 'All images'}
            </span>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{images.length}</span>
        </button>

        {/* Date folders */}
        <div className="mt-1 space-y-0.5">
          {folders.map((f) => {
            const active = selectedFolder === f.key
            return (
              <button
                key={f.key}
                onClick={() => setSelectedFolder(f.key)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors ${
                  active
                    ? 'bg-primary/10 text-foreground ring-1 ring-primary/30'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                {f.coverIsVideo ? (
                  <video
                    src={f.coverUrl}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-10 w-10 shrink-0 rounded-md object-cover ring-1 ring-border bg-muted"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.coverUrl}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-md object-cover ring-1 ring-border bg-muted"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{f.label}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{f.count}</span>
              </button>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
