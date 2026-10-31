'use client'

import { Clapperboard } from 'lucide-react'
import SimpleAdvancedSwitch from '@/components/SimpleAdvancedSwitch'
import { GuideChip } from '@/components/GuideLink'
import { useVideoForm } from './video-form-context'
import {
  BriefPanel,
  ContinuationBanner,
  GenerateButton,
  GroupHeader,
  ModelSwitch,
  ModeSwitch,
  RenderPanel,
  RenderSummary,
  SectionLabel,
  SeedField,
} from './VideoFormPanels'
import SimpleVideoForm from './SimpleVideoForm'

/**
 * The classic single-column control panel, used by Text→Video and Image→Video.
 *
 * Director mode does not render this — it spreads the same panels across the
 * four zones of `director/DirectorLayout`. Both read the same state out of
 * `video-form-context`, so a mode switch never loses what you typed.
 *
 * Simple (spec §3) swaps the panels for `SimpleVideoForm`; the footer stays.
 */
export default function VideoGenerationForm() {
  const { workflow, simple } = useVideoForm()

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
        <GuideChip slug="generate-video" className="ml-auto" />
        <SimpleAdvancedSwitch />
      </div>

      {/* Both views: a Continue must still say what it continues. */}
      <ContinuationBanner />

      {simple ? (
        <SimpleVideoForm />
      ) : (
        <>
          {/* Model first, as on the image page — which modes exist depends on it. */}
          <ModelSwitch />

          <div className="space-y-2">
            <SectionLabel>Mode</SectionLabel>
            <ModeSwitch />
          </div>

          <BriefPanel />

          <GroupHeader>Render</GroupHeader>
          <RenderPanel seed={false} />
        </>
      )}

      {/* Pinned to the bottom of the scroll container. The column is long enough
          that Generate used to sit several screens below the controls that
          decide what it does, and the cost estimate belongs where the decision
          is made rather than after it. The negative margins cancel the page's
          side padding so the bar spans the full panel width; the page gives the
          scroll area no bottom padding (a sticky bar stops at the padding edge,
          and the clip scrolled visibly under it), so the bar carries its own.

          Director does not render this form — its four-zone layout keeps
          Generate visible its own way. */}
      <div className="sticky bottom-0 -mx-5 space-y-2 border-t border-border bg-card/95 px-5 pb-5 pt-3 backdrop-blur">
        {!simple && <SeedField />}
        <RenderSummary />
        <GenerateButton />
      </div>
    </div>
  )
}
