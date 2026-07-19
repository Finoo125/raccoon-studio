import { describe, it, expect } from 'vitest'
import { buildRerunPrompt } from './rerun'
import { workflows } from '@/lib/workflows'

describe('buildRerunPrompt', () => {
  it('rebuilds an image prompt from a stored record', () => {
    const wf = workflows[0]
    const out = buildRerunPrompt({
      kind: 'image',
      workflowId: wf.id,
      generationParams: { ...wf.defaultParams, prompt: 'a cat', seed: 5 },
    })
    expect(out.workflowName).toBe(wf.name)
    expect(out.prompt).toBeTypeOf('object')
  })

  it('throws on an unknown workflow', () => {
    expect(() => buildRerunPrompt({ kind: 'image', workflowId: 'nope', generationParams: {} }))
      .toThrow('Unknown workflow')
  })

  it('throws on an unknown video workflow', () => {
    expect(() => buildRerunPrompt({ kind: 'video', workflowId: 'nope', generationParams: {} }))
      .toThrow('Unknown workflow')
  })
})
