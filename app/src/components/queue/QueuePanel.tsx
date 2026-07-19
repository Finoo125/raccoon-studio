'use client'

import { RotateCw, Trash2, Images, Clapperboard } from 'lucide-react'
import { useQueueStore } from '@/lib/comfyui/queue'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

export default function QueuePanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const jobs = useQueueStore((s) => s.jobs)
  const removeJob = useQueueStore((s) => s.removeJob)
  const clearCompleted = useQueueStore((s) => s.clearCompleted)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[26rem] max-w-[92vw] overflow-y-auto p-0" showCloseButton={false}>
        <SheetHeader className="sticky top-0 z-10 flex flex-row items-center justify-between border-b border-border bg-card/90 px-4 py-3 backdrop-blur">
          <SheetTitle className="text-sm font-semibold">Queue &amp; history</SheetTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => { void fetch('/api/queue/history', { method: 'DELETE' }); clearCompleted() }}
          >
            Clear completed
          </Button>
        </SheetHeader>
        <div className="space-y-2 p-3">
          {jobs.length === 0 && (
            <p className="px-1 py-8 text-center text-sm text-muted-foreground">No jobs yet.</p>
          )}
          {[...jobs].sort((a, b) => b.createdAt - a.createdAt).map((job) => {
            const thumb = job.outputImages[0] ?? job.livePreview
            return (
              <div key={job.id} className="flex gap-3 rounded-lg border border-border bg-card p-2.5">
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
                  {thumb ? (
                    job.kind === 'video' && job.outputVideos?.[0] ? (
                      <video src={job.outputVideos[0]} className="h-full w-full object-cover" muted />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    )
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      {job.kind === 'video' ? (
                        <Clapperboard className="h-4 w-4" />
                      ) : (
                        <Images className="h-4 w-4" />
                      )}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{job.workflowName}</p>
                  <p className="truncate text-xs text-muted-foreground">{job.prompt}</p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{job.status}</p>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Re-run"
                    onClick={() => window.dispatchEvent(new CustomEvent('queue:rerun', { detail: job.id }))}
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Remove"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('queue:remove', { detail: job.id }))
                      removeJob(job.id)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </SheetContent>
    </Sheet>
  )
}
