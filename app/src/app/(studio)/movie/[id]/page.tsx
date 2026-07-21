'use client'

import React, { use, useEffect, useState } from 'react'
import Link from 'next/link'
import AddonGuard from '@/components/addons/AddonGuard'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MovieProject } from '@/types/movie'
import MovieEditor from '@/components/movie/MovieEditor'

export default function MovieEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [project, setProject] = useState<MovieProject | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/movies/${id}`, { cache: 'no-store' })
        if (!res.ok) throw new Error()
        const data = (await res.json()) as { project: MovieProject }
        if (!cancelled) setProject(data.project)
      } catch {
        if (!cancelled) setNotFound(true)
      }
    })()
    return () => { cancelled = true }
  }, [id])

  let inner: React.ReactNode
  if (notFound) {
    inner = (
      <div className="flex flex-col items-center gap-4 py-24">
        <p className="text-sm text-muted-foreground">Movie project not found.</p>
        <Button size="lg" variant="outline" nativeButton={false} render={<Link href="/movie" />}>
          <ArrowLeft data-icon="inline-start" />
          Back to projects
        </Button>
      </div>
    )
  } else if (!project) {
    inner = <p className="text-sm text-muted-foreground text-center py-24">Loading…</p>
  } else {
    inner = <MovieEditor project={project} />
  }

  return <AddonGuard featureId="movie-maker">{inner}</AddonGuard>
}
