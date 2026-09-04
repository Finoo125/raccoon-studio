'use client'

import { create } from 'zustand'
import type { GenerationParams } from '@/types/workflow'
import type { VideoGenerationParams } from '@/types/video-workflow'
import type { GalleryImage } from '@/types/gallery'
import { emptyTimeline, type DirectorTimeline } from '@/lib/workflows/director-timeline'

export interface StudioPrefill {
  workflowId: string
  /** Partial — merged over the workflow's defaults by the form's prefill effect. */
  params: Partial<GenerationParams & VideoGenerationParams>
  /**
   * Video-only: a locked i2v seed image already in ComfyUI's input dir. The video
   * form sets it as the source image and feeds `b64` to the enhancer's vision pass.
   */
  videoSeed?: { filename: string; b64: string; previewUrl: string }
  /**
   * Video-only: the seed-hunt batch size the form should adopt, 0 = off.
   *
   * It rides the prefill rather than the params because `huntCount` is
   * deliberately form-local — `seedHunt` is a per-job flag and must never reach
   * the persisted params or a rerun. This is how a caller that runs *before*
   * the form exists (the Continue dialog, launched from the gallery) still gets
   * to set it.
   */
  huntCount?: number
}

interface StudioState {
  /**
   * The Director timeline lives here rather than in the video form's params
   * because it is edited in its own full-width panel, not in the control
   * column — the two are in different parts of the page. The form reads it
   * back when it builds a job.
   */
  directorTimeline: DirectorTimeline
  setDirectorTimeline(t: DirectorTimeline): void
  activeImageUrl: string | null
  /** Newest finished video URL, shown on the Generate Videos canvas. */
  activeVideoUrl: string | null
  prefill: StudioPrefill | null
  /**
   * The clip the Continue dialog is asking about (null = closed). Held here so
   * one dialog can be mounted in the studio layout instead of one per Continue
   * button — there are three, in three different shells.
   */
  continueTarget: GalleryImage | null
  /** Image URL currently open in the generate-tab inspector modal (null = closed). */
  inspectImageUrl: string | null
  /** Video URL currently open in the generate-videos inspector modal (null = closed). */
  inspectVideoUrl: string | null
  setActiveImage(url: string | null): void
  setActiveVideo(url: string | null): void
  setPrefill(prefill: StudioPrefill | null): void
  setContinueTarget(video: GalleryImage | null): void
  setInspectImage(url: string | null): void
  setInspectVideo(url: string | null): void
}

export const useStudioStore = create<StudioState>((set) => ({
  directorTimeline: emptyTimeline(),
  setDirectorTimeline: (directorTimeline) => set({ directorTimeline }),
  activeImageUrl: null,
  activeVideoUrl: null,
  prefill: null,
  continueTarget: null,
  inspectImageUrl: null,
  inspectVideoUrl: null,
  setActiveImage: (activeImageUrl) => set({ activeImageUrl }),
  setActiveVideo: (activeVideoUrl) => set({ activeVideoUrl }),
  setPrefill: (prefill) => set({ prefill }),
  setContinueTarget: (continueTarget) => set({ continueTarget }),
  setInspectImage: (inspectImageUrl) => set({ inspectImageUrl }),
  setInspectVideo: (inspectVideoUrl) => set({ inspectVideoUrl }),
}))
