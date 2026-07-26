export type DirectorStatus =
  | 'draft'
  | 'storyboard'
  | 'opening-image'
  | 'rendering'
  | 'assembling'
  | 'done'
  | 'error'

export type DirectorImageModel = 'anima' | 'z-image-turbo'

export interface DirectorBeat {
  index: number
  videoPrompt: string
  status: 'pending' | 'rendering' | 'done' | 'error'
  error?: string
  promptId?: string
  seedImageFilename?: string
  videoPath?: string
  videoUrl?: string
  lastFrameInputFilename?: string
}

export interface DirectorRun {
  id: string
  /** Optimistic-concurrency revision; bumped by saveRun on every persist. */
  rev?: number
  name: string
  createdAt: string
  modifiedAt: string
  status: DirectorStatus
  plot: string
  imageModel: DirectorImageModel
  ollamaModel: string
  targetSeconds: number
  clipSeconds: number
  /**
   * Final clip resolution, passed straight to ltx23 as `vramMode`: 'high' is
   * Full HD (~2 MP), 'low' is 720p (~0.9 MP) for roughly 2.3x fewer pixels.
   * Undefined on runs saved before this existed — treated as 'high'.
   */
  videoResolution?: 'high' | 'low'
  beatCount: number
  openingImagePrompt: string
  negativePrompt?: string
  openingImage?: { inputFilename: string; url: string }
  beats: DirectorBeat[]
  movieProjectId?: string
}

export interface DirectorRunSummary {
  id: string
  name: string
  status: DirectorStatus
  createdAt: string
  modifiedAt: string
  beatCount: number
}

/** Fixed beat (clip) length in seconds. */
export const CLIP_SECONDS = 15
/** Allowed target-length bounds (seconds). */
export const MIN_TARGET_SECONDS = 60
export const MAX_TARGET_SECONDS = 120

/** Parsed storyboard returned by the Ollama parser. */
export interface ParsedStoryboard {
  openingImagePrompt: string
  negativePrompt?: string
  beats: string[]
}
