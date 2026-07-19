'use client'

import { useEffect, useState } from 'react'
import { Download, Clapperboard, Clock, Check, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQueueStore } from '@/lib/comfyui/queue'
import { useStudioStore } from '@/lib/generation/studio-store'
import { formatEta } from '@/lib/generation/eta'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { useDirectorStage } from '@/lib/director/director-stage'

/**
 * Center stage for the Generate Videos page. While a video job samples it shows
 * the live latent preview frames (same websocket path as images); on completion
 * it swaps to an inline <video> player for the finished mp4.
 */
export default function VideoCanvas() {
  const [isHovered, setIsHovered] = useState(false)
  const director = useDirectorStage('video')
  const activeVideoUrl = useStudioStore((s) => s.activeVideoUrl)
  const jobs = useQueueStore((s) => s.jobs)

  // Track the active video job from submit through completion (running, else the
  // freshly-queued pending one) so the progress bar appears immediately.
  const runningJob =
    jobs.find((j) => j.kind === 'video' && j.status === 'running') ??
    jobs.find((j) => j.kind === 'video' && j.status === 'pending')

  const isRunning = runningJob != null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isRunning])

  const progress =
    runningJob && runningJob.maxProgress > 0
      ? (runningJob.progress / runningJob.maxProgress) * 100
      : null
  const eta = runningJob
    ? formatEta(runningJob.progress, runningJob.maxProgress, runningJob.startedAt, now)
    : null

  // During sampling, show the live preview frame; once done, the finished video.
  const previewUrl = runningJob?.livePreview ?? null

  const handleDownload = () => {
    if (!activeVideoUrl) return
    const a = document.createElement('a')
    a.href = activeVideoUrl
    a.download = `raccoon-studio-${Date.now()}.mp4`
    a.click()
  }

  return (
    <div
      className="relative flex-1 flex items-center justify-center bg-background overflow-hidden"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Ambient surface — only when idle/empty */}
      {!previewUrl && !activeVideoUrl && (
        <>
          <div className="pointer-events-none absolute inset-0 canvas-board opacity-60" />
          <div className="pointer-events-none absolute inset-0 canvas-ambient animate-ambient" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/40" />
        </>
      )}

      <AnimatePresence mode="wait">
        {previewUrl ? (
          <motion.div
            key="preview"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center justify-center w-full h-full p-6"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- live latent preview blob */}
            <img
              src={previewUrl}
              alt="Sampling preview"
              className="max-w-full max-h-full object-contain rounded-xl canvas-artifact shimmer-sweep"
              style={{ maxHeight: 'calc(100vh - 11rem)' }}
            />
          </motion.div>
        ) : activeVideoUrl ? (
          <motion.div
            key={activeVideoUrl}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            className="flex items-center justify-center w-full h-full p-6"
          >
            <video
              key={activeVideoUrl}
              src={activeVideoUrl}
              controls
              autoPlay
              loop
              className="max-w-full max-h-full object-contain rounded-xl canvas-artifact"
              style={{ maxHeight: 'calc(100vh - 11rem)' }}
            />
          </motion.div>
        ) : (
          <motion.div
            key="placeholder"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative z-10 flex flex-col items-center gap-6 px-6 text-center select-none max-w-xl"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
              <Clapperboard className="h-7 w-7 text-primary" />
            </div>
            <div className="space-y-2">
              <h2 className="font-heading text-3xl font-semibold tracking-tight text-balance text-foreground">
                Bring it to life
              </h2>
              <p className="text-sm text-muted-foreground text-balance">
                Describe a shot on the left and generate an LTX 2.3 video clip.
              </p>
              <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/80">
                <Clock className="h-3.5 w-3.5" /> Video generation takes several minutes.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Progress bar — pinned to the canvas bottom while a job runs */}
      {runningJob && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-0 left-0 right-0 border-t border-action/25 bg-card/85 px-4 py-2 backdrop-blur-md"
        >
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 font-medium text-action">
              <span className="h-1.5 w-1.5 rounded-full bg-action animate-pulse" />
              {runningJob.maxProgress > 0 ? 'Rendering video' : 'Queued…'}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {runningJob.maxProgress > 0
                ? `${Math.round(progress ?? 0)}%${eta ? ` · ${eta}` : ''} · ${runningJob.progress}/${runningJob.maxProgress} steps`
                : runningJob.workflowName}
            </span>
          </div>
          <Progress
            value={progress ?? 0}
            className="[&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-indicator]]:bg-action"
          />
        </motion.div>
      )}

      {/* Hover controls */}
      {isHovered && activeVideoUrl && !runningJob && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute top-3 right-3 flex gap-1.5"
        >
          {director && (
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-primary text-primary-foreground"
              title={`Use this for ${director.label}`}
              disabled={director.selecting}
              onClick={() => activeVideoUrl && void director.onSelect(activeVideoUrl)}
            >
              {director.selecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Use this clip
            </Button>
          )}
          <Button
            size="icon"
            variant="secondary"
            className="h-8 w-8 bg-background/80 backdrop-blur-sm"
            title="Download"
            onClick={handleDownload}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </motion.div>
      )}
    </div>
  )
}
