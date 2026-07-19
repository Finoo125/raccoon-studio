'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DirectorRun } from '@/types/director'
import PlotStep from './PlotStep'
import StoryboardStep from './StoryboardStep'
import OpeningImageStep from './OpeningImageStep'
import RenderStep from './RenderStep'
import AssembleStep from './AssembleStep'

const STEPS = ['Plot', 'Storyboard', 'Opening image', 'Render', 'Assemble'] as const

// fire-and-forget — swallow errors, VRAM freeing is best-effort
function freeVram() {
  void fetch('/api/comfyui/free', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  }).catch(() => undefined)
}

function stepForStatus(status: DirectorRun['status']): number {
  switch (status) {
    case 'draft': return 0
    case 'storyboard': return 1
    case 'opening-image': return 2
    case 'rendering': return 3
    case 'assembling':
    case 'done': return 4
    case 'error': return 0 // errored run: send the user back to the Plot step to retry
    default: return 0
  }
}

export default function DirectorWizard({ runId }: { runId: string }) {
  const router = useRouter()
  const [run, setRun] = useState<DirectorRun | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/director/${runId}`, { cache: 'no-store' })
        if (!res.ok) { if (!cancelled) setNotFound(true); return }
        const data = (await res.json()) as { run: DirectorRun }
        if (!cancelled) { setRun(data.run); setStep(stepForStatus(data.run.status)) }
      } catch {
        if (!cancelled) setNotFound(true)
      }
    })()
    return () => { cancelled = true }
  }, [runId])

  const onUpdated = (next: DirectorRun) => {
    setRun(next)
    setStep(stepForStatus(next.status))
    freeVram()
  }

  if (notFound) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        <p className="text-sm text-muted-foreground">This AI film could not be found.</p>
        <Button className="mt-4" variant="outline" onClick={() => router.push('/movie')}>
          Back to Movie Maker
        </Button>
      </div>
    )
  }

  if (!run) {
    return <div className="max-w-3xl mx-auto px-6 py-8 text-sm text-muted-foreground">Loading…</div>
  }

  // Every step uses the site's full width for a consistent, roomy layout. Steps 2
  // (opening image) and 3 (render) additionally fill the full viewport height — their
  // embedded studio flexes into the leftover space so the page never scrolls. The
  // text-form steps (plot, storyboard) stay full-width but flow/scroll naturally.
  const fillHeight = step === 2 || step === 3
  // The furthest step the run has reached — anything at or before it is revisitable.
  const reached = stepForStatus(run.status)
  return (
    <div
      className={cn(
        'flex w-full flex-col px-6',
        fillHeight ? 'h-full py-5' : 'py-8',
      )}
    >
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <Button variant="ghost" size="icon-lg" onClick={() => router.push('/movie')} aria-label="Back">
          <ArrowLeft />
        </Button>
        <h1 className="font-heading font-semibold text-xl truncate">{run.name}</h1>
      </div>

      <ol className="flex items-center gap-2 mb-5 text-sm shrink-0">
        {STEPS.map((label, i) => {
          const navigable = i <= reached && i !== step
          return (
            <li key={label} className="flex items-center gap-2">
              <button
                type="button"
                disabled={!navigable}
                onClick={() => navigable && setStep(i)}
                className={cn(
                  'flex items-center gap-2 rounded-full pr-1 transition-opacity',
                  navigable && 'cursor-pointer hover:opacity-80',
                  !navigable && i !== step && 'cursor-default',
                )}
                aria-current={i === step ? 'step' : undefined}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full text-xs',
                    i === step ? 'bg-primary text-primary-foreground'
                      : i < step ? 'bg-muted text-foreground' : 'bg-muted/50 text-muted-foreground',
                  )}
                >
                  {i + 1}
                </span>
                <span className={cn(i === step ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
              </button>
              {i < STEPS.length - 1 && <span className="text-muted-foreground">›</span>}
            </li>
          )
        })}
      </ol>

      <div className={cn(fillHeight && 'flex min-h-0 flex-1 flex-col')}>
        {step === 0 && <PlotStep run={run} onUpdated={onUpdated} />}
        {step === 1 && <StoryboardStep run={run} onUpdated={onUpdated} />}
        {step === 2 && <OpeningImageStep run={run} onUpdated={onUpdated} />}
        {step === 3 && <RenderStep run={run} onUpdated={onUpdated} />}
        {step === 4 && <AssembleStep run={run} onUpdated={onUpdated} />}
      </div>
    </div>
  )
}
