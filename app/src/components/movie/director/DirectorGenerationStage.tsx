'use client'

import { Suspense, useEffect, useState } from 'react'
import { useStudioStore, type StudioPrefill } from '@/lib/generation/studio-store'
import { DirectorStageProvider } from '@/lib/director/director-stage'
import GenerationForm from '@/components/generation/GenerationForm'
import StudioCanvas from '@/components/generation/StudioCanvas'
import RecentRail from '@/components/generation/RecentRail'
import GenerateInspector from '@/components/generation/GenerateInspector'
import VideoGenerationForm from '@/components/generation/VideoGenerationForm'
import VideoCanvas from '@/components/generation/VideoCanvas'
import RecentVideoRail from '@/components/generation/RecentVideoRail'
import VideoInspector from '@/components/generation/VideoInspector'

/**
 * Embeds the full Generate Image / Generate Videos studio inside a Director
 * wizard step. The same components the standalone tabs use, seeded via the
 * studio-store `prefill`, with a Director context that surfaces a "Use this"
 * button on finished outputs. The wizard supplies `useGenerationWebSocket()`.
 */
export default function DirectorGenerationStage({
  kind, label, prefill, onSelect,
}: {
  kind: 'image' | 'video'
  label: string
  prefill: StudioPrefill
  onSelect: (url: string) => void | Promise<void>
}) {
  const setPrefill = useStudioStore((s) => s.setPrefill)
  const [selecting, setSelecting] = useState(false)

  // Seed the embedded form once on mount (and whenever the prefill identity
  // changes — the render step remounts this per beat via a `key`).
  useEffect(() => {
    setPrefill(prefill)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once per mount
  }, [])

  const handleSelect = async (url: string) => {
    if (selecting) return
    setSelecting(true)
    try {
      await onSelect(url)
    } finally {
      setSelecting(false)
    }
  }

  return (
    <DirectorStageProvider value={{ kind, label, selecting, onSelect: handleSelect }}>
      <div className="flex h-full min-h-[26rem] overflow-hidden rounded-xl border border-border bg-card">
        <div className="w-[26.25rem] shrink-0 overflow-y-auto border-r border-border p-4">
          {kind === 'image' ? <Suspense fallback={null}><GenerationForm /></Suspense> : <VideoGenerationForm />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {kind === 'image' ? <StudioCanvas /> : <VideoCanvas />}
        </div>
        {kind === 'image' ? <RecentRail /> : <RecentVideoRail />}
      </div>
      {kind === 'image' ? <GenerateInspector /> : <VideoInspector />}
    </DirectorStageProvider>
  )
}
