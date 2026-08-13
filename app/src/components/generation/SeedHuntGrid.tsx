'use client'

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useQueueStore, isSeedHunt, type GenerationJob } from '@/lib/comfyui/queue'
import { useStudioStore } from '@/lib/generation/studio-store'
import { cancelVideoJobs } from '@/lib/comfyui/cancel-video'
import { submitPrompt } from '@/lib/comfyui/submit'
import { ltx23Workflow } from '@/lib/workflows/ltx23'
import { getVideoWorkflow } from '@/lib/workflows/video-index'
import { Button } from '@/components/ui/button'
import type { VideoGenerationParams } from '@/types/video-workflow'

const seedOf = (job: GenerationJob) => (job.generationParams as VideoGenerationParams).seed

/**
 * The seed-hunt candidate grid: one tile per stage-1 render — live latent frames
 * while it samples, then the finished half-res clip on loop.
 *
 * Clicking a tile writes its seed into the form through the prefill channel, so
 * the prompt or LoRAs can still be tweaked before committing. "Render this"
 * commits straight away.
 */
export default function SeedHuntGrid({ jobs }: { jobs: GenerationJob[] }) {
  const [picked, setPicked] = useState<string | null>(null)
  const [committing, setCommitting] = useState(false)
  const clientId = useQueueStore((s) => s.clientId)
  const addJob = useQueueStore((s) => s.addJob)
  const setPrefill = useStudioStore((s) => s.setPrefill)

  const ready = jobs.filter((j) => j.outputVideos?.length).length

  // Portrait candidates want a single row — a 2×2 of tall cells throws away most
  // of its width — while landscape and square letterbox better two-up. i2v has no
  // orientation field, so fall back to the source image's own aspect.
  const first = jobs[0]?.generationParams as VideoGenerationParams | undefined
  const portrait =
    first?.mode === 'i2v'
      ? (first.inputImageWidth ?? 0) < (first.inputImageHeight ?? 0)
      : first?.orientation === 'portrait'
  const cols = Math.max(1, portrait ? jobs.length : Math.min(jobs.length, 2))
  const rows = Math.ceil(jobs.length / cols)

  /**
   * The workflow that produced a candidate — never assume LTX. H3 hunts too,
   * and rebuilding an H3 candidate with the LTX builder would render a
   * completely different clip from the one that was picked.
   */
  const workflowOf = (job: GenerationJob) => getVideoWorkflow(job.workflowId) ?? ltx23Workflow

  const select = (job: GenerationJob) => {
    setPicked(job.id)
    setPrefill({ workflowId: workflowOf(job).id, params: { seed: seedOf(job) } })
  }

  const commit = async (job: GenerationJob) => {
    setCommitting(true)
    try {
      // The candidate's own job params ARE the full render's params, minus the
      // hunt flag. Reading them off the job rather than off the live form means
      // editing the prompt while candidates render cannot desync the finished
      // clip from the one that was picked.
      const wf = workflowOf(job)
      // Clearing `seedHunt` is what promotes a candidate to the real render. On
      // H3 that also drops Draft mode back to whatever the user actually chose,
      // because the builder forces Turbo on for candidates only — so the final
      // clip is full quality even though the candidate was not.
      const p: VideoGenerationParams = {
        ...(job.generationParams as VideoGenerationParams),
        seedHunt: false,
        // ...and explicitly off, not merely un-forced. A candidate carries
        // whatever the Draft toggle said when the hunt started, so without this
        // a hunt begun in Draft mode would promote to a *draft* — while the
        // panel promises "rendered again at full quality with Draft mode off".
        // The whole point of the hunt is cheap seeds, expensive keeper.
        turbo: false,
      }
      // Abandon the candidates still outstanding — otherwise the real render
      // queues behind clips that have already been rejected.
      await cancelVideoJobs(useQueueStore.getState().jobs.filter(isSeedHunt))
      const prompt_id = await submitPrompt({
        prompt: wf.buildPrompt(p),
        client_id: clientId,
        extra_data: { preview_method: 'auto' },
      })
      addJob(prompt_id, wf.id, wf.name, p.prompt, p, 'video')
      toast.success(`Rendering seed ${p.seed} in full — this takes a few minutes.`)
    } catch (e) {
      toast.error(`Render failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setCommitting(false)
    }
  }

  return (
    <div className="flex h-full w-full flex-col gap-3 p-6">
      <p className="shrink-0 text-center text-xs text-muted-foreground">
        Seed hunt — {ready}/{jobs.length} candidates ready. Pick the motion you want; only that
        one gets upscaled.
      </p>
      {/* Rows must be minmax(0, 1fr), not the implicit 1fr — that one is
          minmax(auto, 1fr), and its min-content floor lets a tall tile push the
          bottom row out of the container instead of shrinking to fit. Sized here
          rather than via grid-cols-N because Tailwind cannot see a dynamic class. */}
      <div
        className="grid min-h-0 flex-1 gap-3"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
      >
        {jobs.map((job, i) => {
          const clip = job.outputVideos?.[0]
          const isPicked = picked === job.id
          return (
            <div
              key={job.id}
              onClick={() => clip && select(job)}
              // min-h-0/min-w-0: without them the tile inherits a min-content
              // floor from the video and refuses to shrink into its cell.
              className={`group relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-xl bg-card/40 ring-1 transition-all ${
                isPicked ? 'ring-2 ring-primary' : 'ring-border hover:ring-primary/50'
              } ${clip ? 'cursor-pointer' : ''}`}
            >
              {clip ? (
                <video
                  // Stable key — the src is a /view link, and keying an animated
                  // element on media that can change mid-render thrashes it.
                  key={job.id}
                  src={clip}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="max-h-full max-w-full object-contain"
                />
              ) : job.livePreview ? (
                /* eslint-disable-next-line @next/next/no-img-element -- live latent preview blob */
                <img
                  src={job.livePreview}
                  alt={`Candidate ${i + 1} sampling`}
                  className="max-h-full max-w-full object-contain shimmer-sweep"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-xs">
                    {job.status === 'cancelled'
                      ? 'Cancelled'
                      : job.status === 'error'
                        ? 'Failed'
                        : 'Queued…'}
                  </span>
                </div>
              )}

              <span className="absolute left-2 top-2 rounded-md bg-background/85 px-2 py-0.5 font-mono text-[11px] text-muted-foreground backdrop-blur-sm">
                #{i + 1} · {seedOf(job)}
              </span>

              {clip && (
                <Button
                  size="sm"
                  disabled={committing}
                  className="absolute bottom-2 right-2 h-8 gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    void commit(job)
                  }}
                >
                  {committing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Render this
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
