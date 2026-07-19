'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Clapperboard, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { DirectorRun } from '@/types/director'

export default function AssembleStep({
  run, onUpdated,
}: {
  run: DirectorRun
  onUpdated: (run: DirectorRun) => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const doneCount = run.beats.filter((b) => b.status === 'done').length

  const assemble = async (navigate: boolean) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/director/${run.id}/assemble`, { method: 'POST' })
      const data = (await res.json()) as { movieProjectId?: string; run?: DirectorRun; error?: string }
      if (!res.ok || !data.movieProjectId) throw new Error(data.error ?? 'Assembly failed')
      if (data.run) onUpdated(data.run)
      toast.success('Assembled into a Movie Maker project')
      if (navigate) router.push(`/movie/${data.movieProjectId}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Assembly failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-5 max-w-2xl">
      <div>
        <p className="text-sm font-medium">Assemble the film</p>
        <p className="text-xs text-muted-foreground mt-1">
          Lay all {doneCount} rendered clips end-to-end into a Movie Maker project, where you can
          add music, trim, and export.
        </p>
      </div>

      {run.movieProjectId ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="lg" onClick={() => router.push(`/movie/${run.movieProjectId}`)}>
            <ExternalLink data-icon="inline-start" /> Open in Movie Maker
          </Button>
          <Button size="lg" variant="outline" disabled={busy} onClick={() => void assemble(false)}>
            {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Clapperboard data-icon="inline-start" />}
            Re-assemble
          </Button>
        </div>
      ) : (
        <div>
          <Button size="lg" disabled={busy || doneCount === 0} onClick={() => void assemble(true)}>
            {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Clapperboard data-icon="inline-start" />}
            Assemble &amp; open in Movie Maker
          </Button>
        </div>
      )}
    </div>
  )
}
