'use client'

import { create } from 'zustand'
import type { GenerationParams } from '@/types/workflow'
import type { VideoGenerationParams } from '@/types/video-workflow'

export interface StudioPrefill {
  workflowId: string
  /** Partial — merged over the workflow's defaults by the form's prefill effect. */
  params: Partial<GenerationParams & VideoGenerationParams>
  /**
   * Video-only: a locked i2v seed image already in ComfyUI's input dir. The video
   * form sets it as the source image and feeds `b64` to the enhancer's vision pass.
   */
  videoSeed?: { filename: string; b64: string; previewUrl: string }
}

interface StudioState {
  activeImageUrl: string | null
  /** Newest finished video URL, shown on the Generate Videos canvas. */
  activeVideoUrl: string | null
  prefill: StudioPrefill | null
  /** Image URL currently open in the generate-tab inspector modal (null = closed). */
  inspectImageUrl: string | null
  /** Video URL currently open in the generate-videos inspector modal (null = closed). */
  inspectVideoUrl: string | null
  setActiveImage(url: string | null): void
  setActiveVideo(url: string | null): void
  setPrefill(prefill: StudioPrefill | null): void
  setInspectImage(url: string | null): void
  setInspectVideo(url: string | null): void
}

export const useStudioStore = create<StudioState>((set) => ({
  activeImageUrl: null,
  activeVideoUrl: null,
  prefill: null,
  inspectImageUrl: null,
  inspectVideoUrl: null,
  setActiveImage: (activeImageUrl) => set({ activeImageUrl }),
  setActiveVideo: (activeVideoUrl) => set({ activeVideoUrl }),
  setPrefill: (prefill) => set({ prefill }),
  setInspectImage: (inspectImageUrl) => set({ inspectImageUrl }),
  setInspectVideo: (inspectVideoUrl) => set({ inspectVideoUrl }),
}))
