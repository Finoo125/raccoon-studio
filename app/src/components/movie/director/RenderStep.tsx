'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Film, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import DirectorGenerationStage from './DirectorGenerationStage'
import type { DirectorBeat } from '@/types/director'
import { ltx23Workflow } from '@/lib/workflows/ltx23'
import { parseComfyViewUrl } from '@/lib/director/render'
import { allBeatsDone, nextPendingBeat, seedImageForBeat } from '@/lib/director/run-doc'
import { downscaleFileToB64 } from '@/lib/generation/image-b64'
import type { DirectorRun } from '@/types/director'

/** Build the ComfyUI input-dir view URL for a seed filename (may include a subfolder). */
function inputViewUrl(seed: string): string {
  const slash = seed.lastIndexOf('/')
  const subfolder = slash >= 0 ? seed.slice(0, slash) : ''
  const filename = slash >= 0 ? seed.slice(slash + 1) : seed
  return `/api/comfyui/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=input`
}

async function beatPatch(runId: string, body: Record<string, unknown>): Promise<DirectorRun> {
  const res = await fetch(`/api/director/${runId}/beat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as { run?: DirectorRun; error?: string }
  if (!res.ok || !data.run) throw new Error(data.error ?? 'Beat update failed')
  return data.run
}

export default function RenderStep({
  run, onUpdated,
}: {
  run: DirectorRun
  onUpdated: (run: DirectorRun) => void
}) {
  const done = allBeatsDone(run)
  const activeIndex = nextPendingBeat(run)
  const seed = activeIndex !== null ? seedImageForBeat(run, activeIndex) : null

  // Fetch the seed image once per active beat → base64 for the enhancer's vision
  // pass, plus a preview URL for the locked source thumbnail.
  const [seedB64, setSeedB64] = useState<{ index: number; b64: string } | null>(null)
  useEffect(() => {
    let alive = true
    void (async () => {
      if (activeIndex === null || !seed) {
        if (alive) setSeedB64(null)
        return
      }
      try {
        const blob = await (await fetch(inputViewUrl(seed))).blob()
        const file = new File([blob], 'seed.jpg', { type: blob.type || 'image/jpeg' })
        const b64 = await downscaleFileToB64(file)
        if (alive) setSeedB64({ index: activeIndex, b64 })
      } catch {
        if (alive) setSeedB64({ index: activeIndex, b64: '' }) // enhance-with-image just stays disabled
      }
    })()
    return () => { alive = false }
  }, [activeIndex, seed])

  const selectClip = async (url: string) => {
    if (activeIndex === null) return
    const ref = parseComfyViewUrl(url)
    if (!ref) { toast.error('Could not parse the chosen clip URL'); return }
    try {
      const lf = await fetch(`/api/director/${run.id}/last-frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beatIndex: activeIndex, filename: ref.filename, subfolder: ref.subfolder }),
      })
      const data = (await lf.json()) as { inputFilename?: string; videoPath?: string; error?: string }
      if (!lf.ok || !data.inputFilename) throw new Error(data.error ?? 'Last-frame extraction failed')
      onUpdated(await beatPatch(run.id, {
        action: 'done', index: activeIndex,
        videoUrl: url, lastFrameInputFilename: data.inputFilename, videoPath: data.videoPath,
      }))
      toast.success(`Beat ${activeIndex + 1} locked in`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to use this clip')
    }
  }

  const retry = async (index: number) => {
    try {
      onUpdated(await beatPatch(run.id, { action: 'reset', index }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to reset beat')
    }
  }

  const doneCount = run.beats.filter((b) => b.status === 'done').length
  const pct = Math.round((doneCount / Math.max(run.beats.length, 1)) * 100)

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="font-heading text-sm font-semibold">Rendering the film</p>
          <p className="truncate text-xs text-muted-foreground">
            {activeIndex !== null
              ? <>generate takes for beat {activeIndex + 1}, then hit <span className="font-medium text-foreground">Use this clip</span> to lock it in</>
              : 'every beat is locked in'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="whitespace-nowrap text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{doneCount}</span>{' '}/ {run.beats.length} locked
          </p>
        </div>
      </div>

      <BeatFilmstrip beats={run.beats} activeIndex={activeIndex} onRetry={retry} />

      {activeIndex !== null && (
        <div className="flex min-h-0 flex-1 flex-col">
          {seed && seedB64?.index !== activeIndex && (
            <p className="text-sm text-muted-foreground">Loading the seed frame…</p>
          )}

          {/* Mount only once the seed base64 has settled — the embedded form seeds its
              state once on mount, so the b64 (for the enhancer's vision pass) must be
              ready by then to actually reach it. */}
          {seed && seedB64?.index === activeIndex && (
            <DirectorGenerationStage
              key={activeIndex}
              kind="video"
              label={`beat ${activeIndex + 1} of ${run.beats.length}`}
              prefill={{
                workflowId: ltx23Workflow.id,
                params: { prompt: run.beats[activeIndex].videoPrompt, mode: 'i2v', inputImage: seed },
                videoSeed: {
                  filename: seed,
                  b64: seedB64.b64,
                  previewUrl: inputViewUrl(seed),
                },
              }}
              onSelect={selectClip}
            />
          )}

          {!seed && (
            <p className="text-sm text-destructive">
              No seed image for beat {activeIndex + 1} — go back and approve the opening image / previous clip.
            </p>
          )}
        </div>
      )}

      {done && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
          <span className="text-sm font-medium">All clips locked in — your film is ready to assemble.</span>
          <Button
            size="lg"
            className="ml-auto"
            onClick={async () => {
              try {
                const updated: DirectorRun = { ...run, status: 'assembling' }
                const res = await fetch(`/api/director/${run.id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ run: updated }),
                })
                const saved = (await res.json()) as { run?: DirectorRun; error?: string }
                if (!res.ok || !saved.run) throw new Error(saved.error ?? 'Failed to continue')
                onUpdated(saved.run)
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Failed to continue')
              }
            }}
          >
            <Film data-icon="inline-start" /> Continue to assembly
          </Button>
        </div>
      )}
    </div>
  )
}

/** Warm near-black "film stock" tone the strip's perforated bands and dividers use. */
const FILM = 'bg-[hsl(28_16%_12%)]'

/**
 * Horizontal filmstrip of beats — compact, scannable, and thematically on-the-nose
 * for a film render. Each beat is a frame between perforated sprocket bands; the
 * active beat glows, done frames carry a check + redo, errored frames a retry.
 */
function BeatFilmstrip({
  beats, activeIndex, onRetry,
}: {
  beats: DirectorBeat[]
  activeIndex: number | null
  onRetry: (index: number) => void | Promise<void>
}) {
  return (
    <div className={cn('overflow-x-auto rounded-xl p-1 shadow-inner', FILM)}>
      <div className="flex gap-1">
        {beats.map((b) => (
          <BeatFrame key={b.index} beat={b} isActive={b.index === activeIndex} onRetry={onRetry} />
        ))}
      </div>
    </div>
  )
}

function SprocketBand() {
  return (
    <div className={cn('flex h-2.5 items-center justify-around px-2', FILM)} aria-hidden>
      <span className="h-1.5 w-2.5 rounded-[2px] bg-[hsl(40_24%_82%)]" />
      <span className="h-1.5 w-2.5 rounded-[2px] bg-[hsl(40_24%_82%)]" />
      <span className="h-1.5 w-2.5 rounded-[2px] bg-[hsl(40_24%_82%)]" />
    </div>
  )
}

function BeatFrame({
  beat, isActive, onRetry,
}: {
  beat: DirectorBeat
  isActive: boolean
  onRetry: (index: number) => void | Promise<void>
}) {
  const done = beat.status === 'done'
  const error = beat.status === 'error'
  return (
    <div className={cn('flex w-44 shrink-0 flex-col', FILM)}>
      <SprocketBand />
      <div
        className={cn(
          'm-px flex flex-1 flex-col gap-1 p-2 transition-colors',
          done ? 'bg-card' : isActive ? 'bg-primary/10' : error ? 'bg-destructive/5' : 'bg-card/30',
          isActive && 'ring-1 ring-inset ring-primary',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold',
              isActive ? 'bg-primary text-primary-foreground'
                : done ? 'bg-primary/15 text-primary'
                : error ? 'bg-destructive/15 text-destructive'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {beat.index + 1}
          </span>
          {done && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
          {error && <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />}
          {isActive && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> Now
            </span>
          )}
        </div>

        <p className={cn('line-clamp-2 text-xs leading-snug', isActive || done ? 'text-foreground' : 'text-muted-foreground')}>
          {beat.videoPrompt}
        </p>
        {error && beat.error && <p className="line-clamp-1 text-[10px] text-destructive">{beat.error}</p>}

        <div className="mt-auto flex items-center gap-2 pt-1">
          {done && beat.videoUrl && (
            <a href={beat.videoUrl} target="_blank" rel="noreferrer" className="text-[11px] text-primary underline">view</a>
          )}
          {(done || error) && (
            <button
              type="button"
              onClick={() => void onRetry(beat.index)}
              className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" /> {error ? 'Retry' : 'Redo'}
            </button>
          )}
        </div>
      </div>
      <SprocketBand />
    </div>
  )
}
