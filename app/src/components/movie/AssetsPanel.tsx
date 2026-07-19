'use client'

import { useEffect, useState } from 'react'
import { Film, FileQuestion, ImageIcon, Music, RefreshCw, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MovieAsset } from '@/types/movie'
import { useEditorStore } from './editor-store'
import { selectAssets } from './editor-selectors'
import { useEditorActions } from './editor-actions'

interface GalleryVideo {
  filename: string
  path: string
  url: string
  sizeBytes: number
  modifiedAt: string
}

const KIND_ICON = { video: Film, audio: Music, image: ImageIcon } as const

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function AssetsPanel({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<'gallery' | 'project'>('gallery')
  const [galleryVideos, setGalleryVideos] = useState<GalleryVideo[] | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [galleryRefreshKey, setGalleryRefreshKey] = useState(0)
  const assets = useEditorStore(selectAssets)
  const actions = useEditorActions()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/movies/gallery-videos', { cache: 'no-store' })
        const data = (await res.json()) as { videos: GalleryVideo[] }
        if (!cancelled) setGalleryVideos(data.videos)
      } catch {
        toast.error('Failed to load gallery videos')
        if (!cancelled) setGalleryVideos([])
      }
    })()
    return () => { cancelled = true }
  }, [galleryRefreshKey])

  const importFiles = async (files: File[]) => {
    for (const file of files) {
      const fd = new FormData()
      fd.append('file', file)
      try {
        const res = await fetch(`/api/movies/${projectId}/import`, { method: 'POST', body: fd })
        if (res.status === 415) {
          toast.error(`Unsupported file type: ${file.name}`)
          continue
        }
        if (!res.ok) throw new Error()
        const data = (await res.json()) as { asset: MovieAsset }
        actions.addAsset(data.asset)
        setTab('project')
      } catch {
        toast.error(`Failed to import ${file.name}`)
      }
    }
  }

  return (
    <div
      className={cn('flex flex-col h-full', dragOver && 'ring-2 ring-primary ring-inset')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false)
        if (e.dataTransfer.files.length === 0) return
        e.preventDefault()
        void importFiles(Array.from(e.dataTransfer.files))
      }}
    >
      {/* Tabs */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0">
        {(['gallery', 'project'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors capitalize',
              tab === t ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t}
          </button>
        ))}
        {tab === 'gallery' && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto"
            onClick={() => setGalleryRefreshKey((k) => k + 1)}
            aria-label="Refresh gallery"
          >
            <RefreshCw />
          </Button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-1.5">
        {tab === 'gallery' ? (
          galleryVideos === null ? (
            <p className="text-xs text-muted-foreground p-2">Loading…</p>
          ) : galleryVideos.length === 0 ? (
            <p className="text-xs text-muted-foreground p-2">
              No videos in the ComfyUI output folder yet.
            </p>
          ) : (
            galleryVideos.map((v) => (
              <div
                key={v.path}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-raccoon-gallery', JSON.stringify({ path: v.path }))
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted cursor-grab active:cursor-grabbing"
              >
                <Film className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs truncate">{v.filename}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {(v.sizeBytes / 1024 / 1024).toFixed(1)} MB · {new Date(v.modifiedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))
          )
        ) : assets.length === 0 ? (
          <p className="text-xs text-muted-foreground p-2">
            No assets yet. Drag gallery videos to the timeline or drop local files here.
          </p>
        ) : (
          assets.map((a) => {
            const Icon = KIND_ICON[a.kind] ?? FileQuestion
            return (
              <div
                key={a.id}
                draggable={!a.offline}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-raccoon-asset', JSON.stringify({ assetId: a.id }))
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted',
                  a.offline ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing',
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className={cn('text-xs truncate', a.offline && 'line-through text-destructive')}>
                    {a.filename}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {a.offline ? 'File missing' : a.kind === 'image' ? 'Still image' : formatDuration(a.durationSec)}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Drop hint */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-t border-border text-[10px] text-muted-foreground shrink-0">
        <Upload className="h-3 w-3" />
        Drop video, audio or image files to import
      </div>
    </div>
  )
}
