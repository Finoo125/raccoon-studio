'use client'

import { useEffect, useState } from 'react'
import { Download, Clapperboard, Clock, Check, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQueueStore, isSeedHunt } from '@/lib/comfyui/queue'
import SeedHuntGrid from './SeedHuntGrid'
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
export default function VideoCanvas({
  videoRef,
  hideControls = false,
}: {
  /** Director mode drives this element from its transport bar and playhead. */
  videoRef?: React.RefObject<HTMLVideoElement | null>
  /** Suppress the native controls when an external transport owns playback. */
  hideControls?: boolean
} = {}) {
  const [isHovered, setIsHovered] = useState(false)
  const director = useDirectorStage('video')
  const activeVideoUrl = useStudioStore((s) => s.activeVideoUrl)
  const jobs = useQueueStore((s) => s.jobs)

  // Track the active video job from submit through completion (running, else the
  // freshly-queued pending one) so the progress bar appears immediately.
  const runningJob =
    jobs.find((j) => j.kind === 'video' && j.status === 'running') ??
    jobs.find((j) => j.kind === 'video' && j.status === 'pending')

  // The live candidate batch is the contiguous run of hunt jobs at the head of
  // the queue (jobs are prepended). Once the newest video job is not a hunt job
  // the batch is spent, so the committed render takes the canvas back on its own
  // — no dismiss button, no state to reset, and nothing destroyed either way.
  // `jobs` is a stable store reference, so deriving here is safe under zustand v5.
  const huntBatch: typeof jobs = []
  for (const j of jobs) {
    if (j.kind !== 'video') continue
    if (!isSeedHunt(j)) break
    huntBatch.push(j)
  }
  huntBatch.reverse() // oldest first, so the tiles read #1 … #N

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
  // Once the first pass lands there is a real clip to watch, which beats latent
  // frames for judging motion — and motion is the thing the upscale pass will
  // not fix, so this is the moment to cancel if it looks wrong.
  const firstPassUrl = runningJob?.previewVideo ?? null

  // Director mode nests the canvas in a flex column that already bounds it, so
  // the viewport-relative cap (which assumes canvas + rail is the whole page)
  // would leave a gap under the timeline instead.
  const mediaMaxHeight = hideControls ? '100%' : 'calc(100vh - 11rem)'

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
      {!previewUrl && !firstPassUrl && !activeVideoUrl && huntBatch.length === 0 && (
        <>
          <div className="pointer-events-none absolute inset-0 canvas-board opacity-60" />
          <div className="pointer-events-none absolute inset-0 canvas-ambient animate-ambient" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/40" />
        </>
      )}

      <AnimatePresence mode="wait">
        {huntBatch.length > 0 ? (
          <motion.div
            key="hunt"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            // The progress bar below is absolutely pinned to the canvas bottom,
            // so it sits on top of the last row of tiles while candidates are
            // still rendering. Reserve its height for exactly as long as it is up
            // — the other branches dodge this with their own maxHeight calc.
            className={`h-full w-full ${runningJob ? 'pb-14' : ''}`}
          >
            <SeedHuntGrid jobs={huntBatch} />
          </motion.div>
        ) : firstPassUrl ? (
          <motion.div
            // Stable key — the url is a /view link, but keying on media that can
            // change mid-render thrashes the element (see the latent-preview rule).
            key="firstpass"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="relative flex items-center justify-center w-full h-full p-6"
          >
            <video
              src={firstPassUrl}
              autoPlay
              loop
              muted
              playsInline
              className="max-w-full max-h-full object-contain rounded-xl canvas-artifact"
              style={{ maxHeight: mediaMaxHeight }}
            />
            <span className="absolute top-4 left-4 rounded-md bg-background/85 px-2 py-1 text-xs font-medium text-action backdrop-blur-sm ring-1 ring-action/25">
              First pass · motion preview
            </span>
          </motion.div>
        ) : previewUrl ? (
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
              style={{ maxHeight: mediaMaxHeight }}
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
              ref={videoRef}
              src={activeVideoUrl}
              controls={!hideControls}
              autoPlay
              loop
              className="max-w-full max-h-full object-contain rounded-xl canvas-artifact"
              style={{ maxHeight: mediaMaxHeight }}
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
                {/* Deliberately does not name the model. This canvas is shared by
                    three flows — the video page, LTX Director and Movie Maker's
                    director stage — and only the first two sit inside
                    VideoFormProvider, so reading the active model here would
                    throw in Movie Maker. The model picker is on the left anyway. */}
                Describe a shot on the left and generate a video clip.
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
