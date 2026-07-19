'use client'

import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { GenerationParams } from '@/types/workflow'
import type { VideoGenerationParams } from '@/types/video-workflow'

export type JobStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled'

/** Distinguishes image jobs (SaveImage → outputImages) from video jobs
 * (VHS_VideoCombine → outputVideos). The two share the queue + websocket. */
export type JobKind = 'image' | 'video'

export interface GenerationJob {
  id: string
  promptId: string
  workflowId: string
  workflowName: string
  prompt: string
  kind: JobKind
  generationParams: GenerationParams | VideoGenerationParams
  status: JobStatus
  progress: number
  maxProgress: number
  currentNode: string | null
  outputImages: string[]
  /** Video view URLs for video jobs (VHS `gifs` outputs). */
  outputVideos?: string[]
  error?: string
  createdAt: number
  startedAt?: number
  endedAt?: number
  livePreview?: string
}

interface QueueState {
  clientId: string
  jobs: GenerationJob[]
  addJob(
    promptId: string,
    workflowId: string,
    workflowName: string,
    prompt: string,
    generationParams: GenerationParams | VideoGenerationParams,
    kind?: JobKind,
  ): string
  updateJob(id: string, patch: Partial<GenerationJob>): void
  clearCompleted(): void
  removeJob(id: string): void
  hydrateHistory(records: import('@/lib/queue/history').JobRecord[]): void
}

export const useQueueStore = create<QueueState>((set) => ({
  clientId: uuidv4(),

  jobs: [],

  addJob(promptId, workflowId, workflowName, prompt, generationParams, kind = 'image') {
    const id = uuidv4()
    set((s) => ({
      jobs: [
        {
          id,
          promptId,
          workflowId,
          workflowName,
          prompt,
          kind,
          generationParams,
          status: 'pending',
          progress: 0,
          maxProgress: 0,
          currentNode: null,
          outputImages: [],
          createdAt: Date.now(),
        },
        ...s.jobs,
      ],
    }))
    return id
  },

  updateJob(id, patch) {
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)),
    }))
  },

  clearCompleted() {
    set((s) => ({ jobs: s.jobs.filter((j) => j.status === 'pending' || j.status === 'running') }))
  },

  removeJob(id) {
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }))
  },

  hydrateHistory(records) {
    set((s) => {
      const existing = new Set(s.jobs.map((j) => j.id))
      const hydrated: GenerationJob[] = records
        .filter((r) => {
          if (existing.has(r.id)) return false
          existing.add(r.id)
          return true
        })
        .map((r) => ({
          id: r.id,
          promptId: r.promptId,
          workflowId: r.workflowId,
          workflowName: r.workflowName,
          prompt: r.prompt,
          kind: r.kind,
          generationParams: r.generationParams as GenerationJob['generationParams'],
          status: r.status,
          progress: 1,
          maxProgress: 1,
          currentNode: null,
          outputImages: r.outputImages,
          outputVideos: r.outputVideos,
          error: r.error,
          createdAt: r.createdAt,
          endedAt: r.endedAt,
        }))
      // History is newest-first; keep live (session) jobs on top, history below.
      return { jobs: [...s.jobs, ...hydrated] }
    })
  },
}))
