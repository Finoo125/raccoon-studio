import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cancelVideoJobs } from './cancel-video'
import { useQueueStore, type GenerationJob } from './queue'

const job = (over: Partial<GenerationJob>): GenerationJob => ({
  id: 'j',
  promptId: 'p',
  workflowId: 'ltx23',
  workflowName: 'LTX 2.3 Video',
  prompt: 'x',
  kind: 'video',
  generationParams: { prompt: 'x', mode: 't2v', durationSeconds: 5, fps: 30, seed: 1 },
  status: 'pending',
  progress: 0,
  maxProgress: 0,
  currentNode: null,
  outputImages: [],
  createdAt: 0,
  ...over,
})

const fetchCalls = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls

beforeEach(() => {
  useQueueStore.setState({ jobs: [] })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
})

describe('cancelVideoJobs', () => {
  it('does nothing when no job is outstanding', async () => {
    await cancelVideoJobs([job({ status: 'done' }), job({ id: 'k', status: 'cancelled' })])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('interrupts, deletes only the pending prompt ids, and marks all outstanding cancelled', async () => {
    const a = job({ id: 'a', promptId: 'pa', status: 'running' })
    const b = job({ id: 'b', promptId: 'pb', status: 'pending' })
    const done = job({ id: 'c', promptId: 'pc', status: 'done' })
    useQueueStore.setState({ jobs: [a, b, done] })

    await cancelVideoJobs([a, b, done])

    expect(fetchCalls()[0][0]).toBe('/api/comfyui/interrupt')
    expect(fetchCalls()[1][0]).toBe('/api/comfyui/queue')
    // The running job's prompt is already dequeued — only pending ids get deleted.
    expect(JSON.parse(fetchCalls()[1][1].body as string)).toEqual({ delete: ['pb'] })

    const byId = Object.fromEntries(useQueueStore.getState().jobs.map((j) => [j.id, j.status]))
    expect(byId).toEqual({ a: 'cancelled', b: 'cancelled', c: 'done' })
  })

  it('skips the queue delete when everything outstanding is already running', async () => {
    const a = job({ id: 'a', status: 'running' })
    useQueueStore.setState({ jobs: [a] })

    await cancelVideoJobs([a])

    expect(fetchCalls()).toHaveLength(1)
    expect(fetchCalls()[0][0]).toBe('/api/comfyui/interrupt')
  })

  // A dead ComfyUI must still leave the UI in a terminal state, or the form is
  // stuck showing Cancel forever.
  it('still marks jobs cancelled when the interrupt call throws', async () => {
    const a = job({ id: 'a', status: 'running' })
    useQueueStore.setState({ jobs: [a] })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))

    await expect(cancelVideoJobs([a])).rejects.toThrow('offline')
    expect(useQueueStore.getState().jobs[0].status).toBe('cancelled')
  })
})
