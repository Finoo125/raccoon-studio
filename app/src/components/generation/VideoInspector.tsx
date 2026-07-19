'use client'

import { useEffect } from 'react'
import { X, Download, ChevronLeft, ChevronRight, Check } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useStudioStore } from '@/lib/generation/studio-store'
import { useRecentVideosStore } from '@/lib/generation/recent-videos-store'
import { useDirectorStage } from '@/lib/director/director-stage'

/**
 * Centered modal that plays a recent gallery video. Opened by the RecentVideoRail
 * via `studio-store.inspectVideoUrl`. Mirrors GenerateInspector's mechanism
 * (backdrop, spring, Esc/arrow nav) but the media area is a playable <video>.
 */
export default function VideoInspector() {
  const videos = useRecentVideosStore((s) => s.videos)
  const inspectVideoUrl = useStudioStore((s) => s.inspectVideoUrl)
  const setInspectVideo = useStudioStore((s) => s.setInspectVideo)
  const director = useDirectorStage('video')

  const idx = videos.findIndex((v) => v.url === inspectVideoUrl)
  const video = idx >= 0 ? videos[idx] : null
  const prev = idx > 0 ? videos[idx - 1] : null
  const next = idx >= 0 && idx < videos.length - 1 ? videos[idx + 1] : null

  // Esc closes the modal; arrows navigate.
  useEffect(() => {
    if (!video) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInspectVideo(null)
      else if (e.key === 'ArrowLeft' && prev) setInspectVideo(prev.url)
      else if (e.key === 'ArrowRight' && next) setInspectVideo(next.url)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [video, prev, next, setInspectVideo])

  if (!video) return null
  const m = video.metadata

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = video.url
    a.download = video.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast.success('Saving video…')
  }

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
        onClick={() => setInspectVideo(null)}
        role="dialog"
        aria-modal="true"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 280, damping: 28 }}
          className="relative flex w-full max-w-3xl max-h-[88vh] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => setInspectVideo(null)}
            className="absolute top-3 right-3 z-10 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
            title="Close (Esc)"
            aria-label="Close inspector"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="shrink-0 bg-black">
            <video
              key={video.url}
              src={video.url}
              controls
              autoPlay
              loop
              className="max-h-[55vh] w-full object-contain"
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
              <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={!prev} onClick={() => prev && setInspectVideo(prev.url)}>
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <span className="text-xs font-medium text-muted-foreground tabular-nums">
                {idx + 1} of {videos.length}
              </span>
              <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={!next} onClick={() => next && setInspectVideo(next.url)}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="px-4 pt-4">
              {director && (
                <Button
                  className="mb-2 h-11 w-full text-sm font-semibold bg-primary text-primary-foreground"
                  disabled={director.selecting}
                  onClick={async () => { await director.onSelect(video.url); setInspectVideo(null) }}
                >
                  <Check className="h-4 w-4 mr-2" /> Use this for {director.label}
                </Button>
              )}
              <Button variant="outline" className="h-11 w-full text-sm font-semibold" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" /> Save video
              </Button>
            </div>

            <div className="px-4 py-4 space-y-3 text-sm">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Generation details</p>
              {m.workflow && <span className="inline-flex rounded-md bg-secondary px-2 py-0.5 text-xs font-medium">{m.workflow}</span>}
              {m.prompt && <p className="text-sm leading-relaxed">{m.prompt}</p>}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs text-muted-foreground pt-1 border-t border-border">
                {m.seed !== undefined && <div>seed {m.seed}</div>}
                {m.width && m.height && <div>{m.width} × {m.height}</div>}
                <div>{new Date(video.createdAt).toLocaleString()}</div>
              </div>
              {m.prompt === undefined && m.seed === undefined && (
                <p className="text-xs italic text-muted-foreground">No embedded metadata in this file.</p>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
