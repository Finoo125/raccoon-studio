'use client'

import { useEffect, useState } from 'react'
import { Download, Copy, RotateCcw, Maximize2, Sparkles, ArrowUpRight, Check, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { useQueueStore } from '@/lib/comfyui/queue'
import { useStudioStore } from '@/lib/generation/studio-store'
import { canvasMediaKey } from '@/lib/generation/canvas-preview'
import { formatEta } from '@/lib/generation/eta'
import { workflows } from '@/lib/workflows'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import type { GenerationParams } from '@/types/workflow'
import { useDirectorStage } from '@/lib/director/director-stage'

const EXAMPLE_PROMPTS = [
  'A lone raccoon astronaut on a moonlit dune, cinematic, 35mm',
  'Bioluminescent forest at midnight, volumetric fog, ultra detailed',
  'Art deco poster of a neon city skyline, bold geometric shapes',
  'Cozy rainy café window, warm light, soft bokeh, film grain',
]

export default function StudioCanvas() {
  const [isHovered, setIsHovered] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const { activeImageUrl, setPrefill } = useStudioStore()
  const director = useDirectorStage('image')
  const jobs = useQueueStore((s) => s.jobs)

  const handleExample = (prompt: string) => {
    setPrefill({ workflowId: workflows[0].id, params: { prompt } as GenerationParams })
    toast.success('Prompt loaded — tweak it or hit Generate')
  }

  // Track the active job from submission through completion: prefer a running
  // job, else a freshly-queued (pending) one. Pending is set synchronously on
  // submit, so the progress bar reliably appears for every generation — not
  // just the first slow (model-loading) run where 'running' lasts long enough.
  const runningJob =
    jobs.find((j) => j.status === 'running') ?? jobs.find((j) => j.status === 'pending')
  const displayUrl = runningJob?.livePreview ?? activeImageUrl

  // Tick a clock once a second while a job runs so the ETA counts down smoothly
  // between step updates. Reading state (not Date.now()) keeps render pure.
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

  const activeJob = activeImageUrl
    ? jobs.find((j) => j.status === 'done' && j.outputImages.includes(activeImageUrl))
    : null

  const handleDownload = () => {
    if (!activeImageUrl) return
    const a = document.createElement('a')
    a.href = activeImageUrl
    a.download = `raccoon-studio-${Date.now()}.png`
    a.click()
  }

  const handleCopySeed = () => {
    if (!activeJob) return
    navigator.clipboard.writeText(String(activeJob.generationParams.seed))
    toast.success('Seed copied')
  }

  const handleRegenerate = () => {
    if (!activeJob) return
    setPrefill({ workflowId: activeJob.workflowId, params: activeJob.generationParams })
    toast.success('Params loaded — hit Generate')
  }

  return (
    <>
      <div
        className="relative flex-1 flex items-center justify-center bg-background overflow-hidden"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Ambient surface — only when idle/empty */}
        {!displayUrl && (
          <>
            <div className="pointer-events-none absolute inset-0 canvas-board opacity-60" />
            <div className="pointer-events-none absolute inset-0 canvas-ambient animate-ambient" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/40" />
          </>
        )}

        <AnimatePresence mode="wait">
          {displayUrl ? (
            <motion.div
              // Stable key while sampling so live-preview frames update the <img>
              // in place instead of remounting + replaying the spring each frame
              // (which made the noise flicker / not show). See canvasMediaKey.
              key={canvasMediaKey(displayUrl, runningJob?.livePreview)}
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              className="flex items-center justify-center w-full h-full p-6"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={displayUrl}
                alt="Generated"
                className={`max-w-full max-h-full object-contain rounded-xl canvas-artifact ${runningJob ? 'shimmer-sweep' : ''}`}
                style={{ maxHeight: 'calc(100vh - 11rem)' }}
              />
            </motion.div>
          ) : (
            <motion.div
              key="placeholder"
              initial="hidden"
              animate="show"
              variants={{
                hidden: {},
                show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
              }}
              className="relative z-10 flex flex-col items-center gap-6 px-6 text-center select-none max-w-xl"
            >
              <motion.div
                variants={{ hidden: { opacity: 0, scale: 0.8 }, show: { opacity: 1, scale: 1 } }}
                className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20"
              >
                <Sparkles className="h-7 w-7 text-primary" />
              </motion.div>

              <motion.div
                variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                className="space-y-2"
              >
                <h2 className="font-heading text-3xl font-semibold tracking-tight text-balance text-foreground">
                  What will you make tonight?
                </h2>
                <p className="text-sm text-muted-foreground text-balance">
                  Describe an image on the left, or start from one of these.
                </p>
              </motion.div>

              <motion.div
                variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                className="flex flex-wrap items-center justify-center gap-2"
              >
                {EXAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => handleExample(p)}
                    className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3.5 py-2 text-left text-xs text-muted-foreground backdrop-blur-sm transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
                  >
                    <span className="line-clamp-1 max-w-[16rem]">{p}</span>
                    <ArrowUpRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
                  </button>
                ))}
              </motion.div>

              <motion.p
                variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }}
                className="text-xs text-muted-foreground/70"
              >
                Press{' '}
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                  Ctrl
                </kbd>{' '}
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                  Enter
                </kbd>{' '}
                to generate
              </motion.p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Progress bar — slim, full-width, pinned to the canvas bottom */}
        {runningJob && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute bottom-0 left-0 right-0 border-t border-action/25 bg-card/85 px-4 py-2 backdrop-blur-md"
          >
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-medium text-action">
                <span className="h-1.5 w-1.5 rounded-full bg-action animate-pulse" />
                {runningJob.maxProgress > 0 ? 'Generating' : 'Queued…'}
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
        {isHovered && activeImageUrl && !runningJob && (
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
                onClick={() => activeImageUrl && void director.onSelect(activeImageUrl)}
              >
                {director.selecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Use this
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
            {activeJob && (
              <>
                <Button
                  size="icon"
                  variant="secondary"
                  className="h-8 w-8 bg-background/80 backdrop-blur-sm"
                  title="Copy seed"
                  onClick={handleCopySeed}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="secondary"
                  className="h-8 w-8 bg-background/80 backdrop-blur-sm"
                  title="Regenerate with same params"
                  onClick={handleRegenerate}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
            <Button
              size="icon"
              variant="secondary"
              className="h-8 w-8 bg-background/80 backdrop-blur-sm"
              title="Fullscreen"
              onClick={() => setIsFullscreen(true)}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </motion.div>
        )}
      </div>

      {/* Fullscreen overlay */}
      <AnimatePresence>
        {isFullscreen && activeImageUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center cursor-zoom-out"
            onClick={() => setIsFullscreen(false)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeImageUrl}
              alt="Fullscreen"
              className="max-w-full max-h-full object-contain"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
