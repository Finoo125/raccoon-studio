import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/comfyui/client', () => ({
  queuePrompt: vi.fn(),
  getHistory: vi.fn(),
  cancelPrompt: vi.fn(async () => ({})),
}))

import { cancelPrompt, getHistory, queuePrompt } from '@/lib/comfyui/client'
import { buildWriterGraph, runBuiltinWriter, WriterTimeout } from './writer'

const msgs = [{ role: 'system' as const, content: 'SYS' }, { role: 'user' as const, content: 'Idea: a fox' }]

beforeEach(() => {
  vi.mocked(queuePrompt).mockReset().mockResolvedValue({ prompt_id: 'p1', number: 1, node_errors: {} } as never)
  vi.mocked(getHistory).mockReset()
  vi.mocked(cancelPrompt).mockClear()
})

describe('buildWriterGraph', () => {
  it("runs Krea2's text encoder with thinking on and the given seed", () => {
    const g = buildWriterGraph('hello', 42)
    expect(g['pw:clip'].inputs).toMatchObject({ clip_name: 'qwen3vl_4b_fp8_scaled.safetensors', type: 'krea2' })
    expect(g['pw:gen'].inputs).toMatchObject({ prompt: 'hello', thinking: true, max_length: 512, 'sampling_mode.seed': 42 })
    expect(g['pw:out']).toMatchObject({ class_type: 'PreviewAny', inputs: { source: ['pw:gen', 0] } })
  })
})

describe('runBuiltinWriter', () => {
  it('queues at the front and returns the text once the job completes', async () => {
    vi.mocked(getHistory)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ p1: { status: { completed: true, status_str: 'success' }, outputs: { 'pw:out': { text: ['A red fox'] } } } } as never)
    await expect(runBuiltinWriter(msgs, { intervalMs: 1, seed: 7 })).resolves.toBe('A red fox')
    const [graph, , front] = vi.mocked(queuePrompt).mock.calls[0]
    expect(front).toBe(true)
    expect((graph as Record<string, { inputs: Record<string, unknown> }>)['pw:gen'].inputs.prompt).toBe('SYS\n\nIdea: a fox')
  })

  it("throws ComfyUI's own message when the job errors", async () => {
    vi.mocked(getHistory).mockResolvedValue({
      p1: { status: { completed: false, status_str: 'error', messages: [['execution_error', { exception_message: 'CUDA out of memory' }]] }, outputs: {} },
    } as never)
    await expect(runBuiltinWriter(msgs, { intervalMs: 1 })).rejects.toThrow('CUDA out of memory')
  })

  it('gives up at the deadline and takes its job back out of the queue', async () => {
    vi.mocked(getHistory).mockResolvedValue({})
    await expect(runBuiltinWriter(msgs, { timeoutMs: 5, intervalMs: 1 })).rejects.toBeInstanceOf(WriterTimeout)
    expect(cancelPrompt).toHaveBeenCalledWith('p1')
  })
})
