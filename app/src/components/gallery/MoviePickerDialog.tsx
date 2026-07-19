'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Film, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

interface MovieProjectLite { id: string; name: string; modifiedAt: string }

export default function MoviePickerDialog({ open, onOpenChange, item }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  item: { dir?: string; filename: string } | null
}) {
  const router = useRouter()
  const [projects, setProjects] = useState<MovieProjectLite[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    void (async () => {
      setProjects(null)
      try {
        const res = await fetch('/api/movies')
        if (res.status === 403) { toast.error('Movie Maker is not enabled'); onOpenChange(false); return }
        const { projects } = (await res.json()) as { projects: MovieProjectLite[] }
        setProjects(projects)
      } catch { toast.error('Could not load projects'); onOpenChange(false) }
    })()
  }, [open, onOpenChange])

  const sendTo = async (projectId: string) => {
    if (!item?.dir) { toast.error('Path unavailable — rescan the gallery'); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/movies/${projectId}/import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `${item.dir}/${item.filename}` }),
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success('Added to Movie Maker')
      onOpenChange(false)
      router.push(`/movie/${projectId}`)
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const createAndSend = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/movies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      })
      const { project } = (await res.json()) as { project: { id: string } }
      await sendTo(project.id)
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`)
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send to Movie Maker</DialogTitle>
          <DialogDescription>Add this item to a project, then open it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Button variant="outline" className="w-full justify-start gap-2 h-10" disabled={busy} onClick={() => void createAndSend()}>
            <Plus className="h-4 w-4" /> New project
          </Button>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {projects === null ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : projects.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No projects yet — create one above.</p>
            ) : projects.map((p) => (
              <button key={p.id} disabled={busy} onClick={() => void sendTo(p.id)}
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm hover:border-primary/40 disabled:opacity-50">
                <Film className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{p.name || 'Untitled'}</span>
                <span className="text-xs text-muted-foreground">{new Date(p.modifiedAt).toLocaleDateString()}</span>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
