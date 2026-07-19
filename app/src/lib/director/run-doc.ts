import { randomUUID } from 'crypto'
import type {
  DirectorRun,
  DirectorBeat,
  DirectorImageModel,
  ParsedStoryboard,
} from '@/types/director'
import {
  CLIP_SECONDS,
  MIN_TARGET_SECONDS,
  MAX_TARGET_SECONDS,
} from '@/types/director'

export function deriveBeatCount(targetSeconds: number, clipSeconds: number): number {
  return Math.max(1, Math.round(targetSeconds / clipSeconds))
}

export interface CreateRunInput {
  name: string
  plot: string
  imageModel: DirectorImageModel
  ollamaModel: string
  targetSeconds: number
}

export function createRunDoc(input: CreateRunInput): DirectorRun {
  const now = new Date().toISOString()
  const targetSeconds = Math.min(
    MAX_TARGET_SECONDS,
    Math.max(MIN_TARGET_SECONDS, Math.round(input.targetSeconds)),
  )
  return {
    id: randomUUID(),
    rev: 0,
    name: input.name.trim() || 'Untitled film',
    createdAt: now,
    modifiedAt: now,
    status: 'draft',
    plot: input.plot,
    imageModel: input.imageModel,
    ollamaModel: input.ollamaModel,
    targetSeconds,
    clipSeconds: CLIP_SECONDS,
    beatCount: deriveBeatCount(targetSeconds, CLIP_SECONDS),
    openingImagePrompt: '',
    beats: [],
  }
}

/** Returns a new run with the storyboard applied (pure; does not mutate input). */
export function applyStoryboard(run: DirectorRun, parsed: ParsedStoryboard): DirectorRun {
  return {
    ...run,
    status: 'storyboard',
    beatCount: parsed.beats.length,
    openingImagePrompt: parsed.openingImagePrompt,
    negativePrompt: parsed.negativePrompt,
    beats: parsed.beats.map((videoPrompt, index) => ({
      index,
      videoPrompt,
      status: 'pending' as const,
    })),
  }
}

/** Returns a new run with the approved opening image stored (pure; no mutation). */
export function applyOpeningImage(
  run: DirectorRun,
  openingImage: { inputFilename: string; url: string },
): DirectorRun {
  return {
    ...run,
    status: 'opening-image',
    openingImage,
  }
}

function patchBeat(run: DirectorRun, index: number, patch: Partial<DirectorBeat>): DirectorRun {
  return {
    ...run,
    beats: run.beats.map((b) => (b.index === index ? { ...b, ...patch } : b)),
  }
}

/** Seed image filename for a beat: opening image for beat 0, prior last frame after. */
export function seedImageForBeat(run: DirectorRun, index: number): string | null {
  if (index === 0) return run.openingImage?.inputFilename ?? null
  return run.beats[index - 1]?.lastFrameInputFilename ?? null
}

export function markBeatRendering(
  run: DirectorRun,
  index: number,
  info: { promptId: string; seedImageFilename: string },
): DirectorRun {
  return {
    ...patchBeat(run, index, {
      status: 'rendering',
      promptId: info.promptId,
      seedImageFilename: info.seedImageFilename,
      error: undefined,
    }),
    status: 'rendering',
  }
}

export function markBeatDone(
  run: DirectorRun,
  index: number,
  info: { videoUrl: string; lastFrameInputFilename: string; videoPath?: string },
): DirectorRun {
  return patchBeat(run, index, {
    status: 'done',
    videoUrl: info.videoUrl,
    videoPath: info.videoPath,
    lastFrameInputFilename: info.lastFrameInputFilename,
    error: undefined,
  })
}

export function markBeatError(run: DirectorRun, index: number, error: string): DirectorRun {
  return patchBeat(run, index, { status: 'error', error })
}

export function resetBeat(run: DirectorRun, index: number): DirectorRun {
  return patchBeat(run, index, { status: 'pending', promptId: undefined, error: undefined })
}

/** Index of the first beat still awaiting render, or null when none remain. */
export function nextPendingBeat(run: DirectorRun): number | null {
  const beat = run.beats.find((b) => b.status === 'pending')
  return beat ? beat.index : null
}

export function allBeatsDone(run: DirectorRun): boolean {
  return run.beats.length > 0 && run.beats.every((b) => b.status === 'done')
}

/** Returns a new run linked to its assembled movie project and marked done. */
export function markAssembled(run: DirectorRun, movieProjectId: string): DirectorRun {
  return { ...run, status: 'done', movieProjectId }
}
