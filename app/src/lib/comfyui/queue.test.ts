import { describe, it, expect, beforeEach } from 'vitest'
import { useQueueStore } from './queue'
import type { JobRecord } from '@/lib/queue/history'
import type { GenerationParams } from '@/types/workflow'

// Minimal valid params placeholder. These tests exercise queue mechanics
// (dedup, removeJob) and don't read param content, but the store types a job's
// generationParams as a full GenerationParams | VideoGenerationParams.
const stubParams: GenerationParams = { prompt: '', width: 512, height: 512, seed: -1 }

beforeEach(() => {
  useQueueStore.setState({ jobs: [] })
})

describe('useQueueStore', () => {
  describe('hydrateHistory', () => {
    it('does not add a record whose id already exists in the store', () => {
      const jobId = 'existing-job-1'
      useQueueStore.setState({
        jobs: [
          {
            id: jobId,
            promptId: 'prompt-1',
            workflowId: 'workflow-1',
            workflowName: 'Test Workflow',
            prompt: '{}',
            kind: 'image' as const,
            generationParams: stubParams,
            status: 'done' as const,
            progress: 1,
            maxProgress: 1,
            currentNode: null,
            outputImages: [],
            createdAt: Date.now(),
          },
        ],
      })

      const record: JobRecord = {
        id: jobId,
        promptId: 'prompt-2',
        kind: 'image',
        workflowId: 'workflow-2',
        workflowName: 'Different Workflow',
        prompt: '{}',
        generationParams: {},
        status: 'done',
        createdAt: Date.now(),
        outputImages: [],
      }

      useQueueStore.getState().hydrateHistory([record])

      expect(useQueueStore.getState().jobs).toHaveLength(1)
      expect(useQueueStore.getState().jobs[0].workflowName).toBe('Test Workflow')
    })

    it('does not add within-batch duplicates (two records with same id in one call)', () => {
      const duplicateId = 'duplicate-1'
      const records: JobRecord[] = [
        {
          id: duplicateId,
          promptId: 'prompt-1',
          kind: 'image',
          workflowId: 'workflow-1',
          workflowName: 'Workflow 1',
          prompt: '{}',
          generationParams: {},
          status: 'done',
          createdAt: Date.now(),
          outputImages: [],
        },
        {
          id: duplicateId,
          promptId: 'prompt-2',
          kind: 'image',
          workflowId: 'workflow-2',
          workflowName: 'Workflow 2',
          prompt: '{}',
          generationParams: {},
          status: 'done',
          createdAt: Date.now(),
          outputImages: [],
        },
      ]

      useQueueStore.getState().hydrateHistory(records)

      expect(useQueueStore.getState().jobs).toHaveLength(1)
      expect(useQueueStore.getState().jobs[0].id).toBe(duplicateId)
      expect(useQueueStore.getState().jobs[0].workflowName).toBe('Workflow 1')
    })

    it('adds distinct records from history', () => {
      const records: JobRecord[] = [
        {
          id: 'job-1',
          promptId: 'prompt-1',
          kind: 'image',
          workflowId: 'workflow-1',
          workflowName: 'Workflow 1',
          prompt: '{}',
          generationParams: {},
          status: 'done',
          createdAt: Date.now(),
          outputImages: [],
        },
        {
          id: 'job-2',
          promptId: 'prompt-2',
          kind: 'image',
          workflowId: 'workflow-2',
          workflowName: 'Workflow 2',
          prompt: '{}',
          generationParams: {},
          status: 'done',
          createdAt: Date.now(),
          outputImages: [],
        },
      ]

      useQueueStore.getState().hydrateHistory(records)

      expect(useQueueStore.getState().jobs).toHaveLength(2)
      expect(useQueueStore.getState().jobs.map((j) => j.id)).toEqual(['job-1', 'job-2'])
    })
  })

  describe('removeJob', () => {
    it('removes the matching job by id', () => {
      useQueueStore.getState().addJob(
        'prompt-1',
        'workflow-1',
        'Workflow 1',
        '{}',
        stubParams,
        'image',
      )
      useQueueStore.getState().addJob(
        'prompt-2',
        'workflow-2',
        'Workflow 2',
        '{}',
        stubParams,
        'image',
      )

      const jobs = useQueueStore.getState().jobs
      const firstJobId = jobs[jobs.length - 1].id

      useQueueStore.getState().removeJob(firstJobId)

      expect(useQueueStore.getState().jobs).toHaveLength(1)
      expect(useQueueStore.getState().jobs[0].id).not.toBe(firstJobId)
    })
  })
})
