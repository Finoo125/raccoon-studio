'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { DirectorRunSummary } from '@/types/director'

const STATUS_LABEL: Record<DirectorRunSummary['status'], string> = {
  draft: 'Draft',
  storyboard: 'Storyboard',
  'opening-image': 'Opening image',
  rendering: 'Rendering',
  assembling: 'Assembling',
  done: 'Done',
  error: 'Error',
}

export default function RunsList() {
  const router = useRouter()
  const [runs, setRuns] = useState<DirectorRunSummary[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<DirectorRunSummary | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/director', { cache: 'no-store' })
        const data = (await res.json()) as { runs: DirectorRunSummary[] }
        if (!cancelled) setRuns(data.runs)
      } catch {
        toast.error('Failed to load AI films')
        if (!cancelled) setRuns([])
      }
    })()
    return () => { cancelled = true }
  }, [refreshKey])

  const create = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/director', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error()
      const data = (await res.json()) as { run: { id: string } }
      router.push(`/movie/director/${data.run.id}`)
    } catch {
      toast.error('Failed to create AI film')
      setCreating(false)
    }
  }

  const remove = async (run: DirectorRunSummary) => {
    setPendingDelete(null)
    try {
      const res = await fetch(`/api/director/${run.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success(`Deleted "${run.name}"`)
      setRefreshKey((k) => k + 1)
    } catch {
      toast.error('Failed to delete AI film')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-end mb-6">
        <Button size="lg" onClick={() => { setName(''); setCreateOpen(true) }}>
          <Plus data-icon="inline-start" />
          New AI film
        </Button>
      </div>

      {runs === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : runs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <Sparkles className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No AI films yet. Write a plot and let the Director build one.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {runs.map((r) => (
            <div
              key={r.id}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/movie/director/${r.id}`)}
              onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/movie/director/${r.id}`) }}
              className="group relative rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium truncate flex items-center gap-2">
                    <Wand2 className="h-4 w-4 text-primary shrink-0" />
                    {r.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {STATUS_LABEL[r.status]} · {r.beatCount} beats · edited{' '}
                    {new Date(r.modifiedAt).toLocaleString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-lg"
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); setPendingDelete(r) }}
                  aria-label={`Delete ${r.name}`}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New AI film</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); void create() }} className="grid gap-3">
            <Input
              autoFocus
              placeholder="Untitled film"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <DialogFooter>
              <Button type="button" size="lg" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={creating}>
                {creating ? 'Creating…' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{pendingDelete?.name}&rdquo;?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the AI film and its assets. Movies you already assembled are kept.
          </p>
          <DialogFooter>
            <Button size="lg" variant="outline" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button
              size="lg"
              variant="destructive"
              onClick={() => { if (pendingDelete) void remove(pendingDelete) }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
