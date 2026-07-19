'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import AddonGuard from '@/components/addons/AddonGuard'
import { Clapperboard, FileUp, Film, Plus, Share2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { MovieProjectSummary } from '@/types/movie'
import ExportProjectDialog from '@/components/movie/ExportProjectDialog'
import { cn } from '@/lib/utils'
import RunsList from '@/components/movie/director/RunsList'

export default function MoviePage() {
  const router = useRouter()
  const [projects, setProjects] = useState<MovieProjectSummary[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<MovieProjectSummary | null>(null)
  const [pendingShare, setPendingShare] = useState<MovieProjectSummary | null>(null)
  const [importing, setImporting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [tab, setTab] = useState<'projects' | 'director'>('projects')
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/movies', { cache: 'no-store' })
        const data = (await res.json()) as { projects: MovieProjectSummary[] }
        if (!cancelled) setProjects(data.projects)
      } catch {
        toast.error('Failed to load movie projects')
        if (!cancelled) setProjects([])
      }
    })()
    return () => { cancelled = true }
  }, [refreshKey])

  const create = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/movies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error()
      const data = (await res.json()) as { project: { id: string } }
      router.push(`/movie/${data.project.id}`)
    } catch {
      toast.error('Failed to create project')
      setCreating(false)
    }
  }

  const importProject = async (file: File) => {
    setImporting(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/movies/import', { method: 'POST', body: fd })
      const data = (await res.json()) as { project?: { id: string; name: string }; error?: string }
      if (!res.ok || !data.project) {
        toast.error(data.error ?? 'Import failed')
        return
      }
      toast.success(`Imported "${data.project.name}"`)
      router.push(`/movie/${data.project.id}`)
    } catch {
      toast.error('Import failed')
    } finally {
      setImporting(false)
    }
  }

  const remove = async (project: MovieProjectSummary) => {
    setPendingDelete(null)
    try {
      const res = await fetch(`/api/movies/${project.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success(`Deleted "${project.name}"`)
      setRefreshKey((k) => k + 1)
    } catch {
      toast.error('Failed to delete project')
    }
  }

  return (
    <AddonGuard featureId="movie-maker">
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center gap-1.5 mb-6">
        <button
          onClick={() => setTab('projects')}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            tab === 'projects' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Projects
        </button>
        <button
          onClick={() => setTab('director')}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            tab === 'director' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Director
        </button>
      </div>

      {tab === 'director' ? (
        <RunsList />
      ) : (
      <>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Clapperboard className="h-5 w-5 text-primary" />
          <h1 className="font-heading font-semibold text-xl">Movie projects</h1>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".rsmovie,.zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void importProject(file)
            }}
          />
          <Button
            size="lg"
            variant="outline"
            disabled={importing}
            onClick={() => importInputRef.current?.click()}
          >
            <FileUp data-icon="inline-start" />
            {importing ? 'Importing…' : 'Import'}
          </Button>
          <Button size="lg" onClick={() => { setName(''); setCreateOpen(true) }}>
            <Plus data-icon="inline-start" />
            New movie
          </Button>
        </div>
      </div>

      {projects === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <Film className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No movie projects yet. Create one to start assembling your videos.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/movie/${p.id}`)}
              onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/movie/${p.id}`) }}
              className="group relative rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Edited {new Date(p.modifiedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground"
                    onClick={(e) => { e.stopPropagation(); setPendingShare(p) }}
                    aria-label={`Share ${p.name}`}
                  >
                    <Share2 />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); setPendingDelete(p) }}
                    aria-label={`Delete ${p.name}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {pendingShare && (
        <ExportProjectDialog
          projectId={pendingShare.id}
          projectName={pendingShare.name}
          open
          onOpenChange={(open) => { if (!open) setPendingShare(null) }}
        />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New movie project</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); void create() }}
            className="grid gap-3"
          >
            <Input
              autoFocus
              placeholder="Untitled movie"
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
            <DialogTitle>Delete “{pendingDelete?.name}”?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the project and its imported assets. Exported movies are kept.
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
      </>
      )}
    </div>
    </AddonGuard>
  )
}
