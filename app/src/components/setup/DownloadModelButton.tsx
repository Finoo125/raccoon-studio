// app/src/components/setup/DownloadModelButton.tsx
'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFileDownloads, useHardware, useOnDisk } from '@/components/setup/hooks'
import { NO_HARDWARE, downloadPlan, fmtGb, versionFor, whyNot, type StarterModel } from '@/lib/models/starter'

/**
 * Stands in for Generate when the picked model is not downloaded: fetches the
 * version that fits this computer, restarts the engine, then reloads so the
 * form sees the new model. Spec §2. `compact` (Director's one-row top bar)
 * keeps the button alone and moves its notes into the tooltip.
 */
export default function DownloadModelButton({ model, className, compact = false }: {
  model: StarterModel
  className?: string
  compact?: boolean
}) {
  const { hw } = useHardware()
  const { onDisk, unknown, reload } = useOnDisk()
  const dl = useFileDownloads()
  // Too big for the card is still allowed — said below the button, not refused.
  const version = versionFor(model, hw ?? NO_HARDWARE) ?? model.versions[model.versions.length - 1]
  const plan = downloadPlan([version], onDisk ?? new Set())
  const tooBig = hw ? whyNot(model, hw) : null

  const { resume } = dl
  useEffect(() => { void resume(version.files) }, [resume, version])
  useEffect(() => {
    if (dl.phase === 'done') window.location.reload()
  }, [dl.phase])
  // A failed restart leaves the files on disk: re-read them so the button offers "Load", not a re-download.
  useEffect(() => {
    if (dl.phase === 'error') reload()
  }, [dl.phase, reload])

  const busy = dl.phase === 'downloading' || dl.phase === 'waiting' || dl.phase === 'restarting'
  const pct = dl.summary.totalBytes ? Math.round((dl.summary.receivedBytes / dl.summary.totalBytes) * 100) : 0
  // Files on disk but not yet seen by the engine (downloaded elsewhere, no restart since): one restart is all it takes.
  const onlyRestart = onDisk !== null && plan.files.length === 0
  const label = dl.phase === 'downloading' ? `Downloading ${model.name} — ${pct}%`
    : dl.phase === 'waiting' ? 'Waiting for your render to finish…'
    : dl.phase === 'restarting' ? 'Restarting the engine…'
    : onlyRestart ? `Load ${model.name}`
    : `Download ${model.name} (${fmtGb(plan.totalMb)} GB)`

  const unknownNote = "The studio can't see this computer's models folder, so it can't download here."
  const errorNote = dl.error && `${dl.error} — press the button to try again.`
  const tooBigNote = tooBig && `${tooBig} It may run very slowly.`
  const button = (
    <Button
      className={className}
      disabled={busy || onDisk === null}
      onClick={() => void (onlyRestart ? dl.restart() : dl.start(plan.files))}
      title={compact
        ? [unknown && unknownNote, errorNote, tooBigNote, 'Not sure which model to get? Start here picks models for your computer.']
          .filter(Boolean).join('\n')
        : undefined}
    >
      {busy ? <Loader2 className={`mr-2 animate-spin ${compact ? 'h-4 w-4' : 'h-5 w-5'}`} /> : <Download className={`mr-2 ${compact ? 'h-4 w-4' : 'h-5 w-5'}`} />}
      {label}
    </Button>
  )
  if (compact) return button

  return (
    <div className="space-y-1.5">
      {button}
      {unknown && <p className="text-xs text-muted-foreground">{unknownNote}</p>}
      {errorNote && <p className="text-xs text-destructive">{errorNote}</p>}
      {tooBigNote && <p className="text-xs text-muted-foreground">{tooBigNote}</p>}
      <p className="text-xs text-muted-foreground">
        Not sure which model to get? <Link href="/setup" className="font-medium text-foreground underline">Open Start here</Link> — it picks models for your computer.
      </p>
    </div>
  )
}
