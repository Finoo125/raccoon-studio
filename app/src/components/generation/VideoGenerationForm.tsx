'use client'

import { Clapperboard } from 'lucide-react'
import { useVideoForm } from './video-form-context'
import {
  BriefPanel,
  ContinuationBanner,
  GenerateButton,
  GroupHeader,
  ModeSwitch,
  RenderPanel,
  SectionLabel,
} from './VideoFormPanels'

/**
 * The classic single-column control panel, used by Text→Video and Image→Video.
 *
 * Director mode does not render this — it spreads the same panels across the
 * four zones of `director/DirectorLayout`. Both read the same state out of
 * `video-form-context`, so a mode switch never loses what you typed.
 */
export default function VideoGenerationForm() {
  const { workflow } = useVideoForm()

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/25">
          <Clapperboard className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="font-heading text-xl font-bold tracking-tight leading-none">Create video</h2>
          <p className="text-xs text-muted-foreground mt-1">{workflow.name}</p>
        </div>
      </div>

      <ContinuationBanner />

      <div className="space-y-2">
        <SectionLabel>Mode</SectionLabel>
        <ModeSwitch />
      </div>

      <BriefPanel />

      <GroupHeader>Render</GroupHeader>
      <RenderPanel />

      <GenerateButton />
    </div>
  )
}
