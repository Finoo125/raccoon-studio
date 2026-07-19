import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildMessages } from './enhance'

describe('prompt-builder system prompts', () => {
  it('photoreal emphasizes skin/realism detail', () => {
    const s = buildSystemPrompt('photoreal', 'enhance').toLowerCase()
    expect(s).toContain('skin')
    expect(s).toContain('photoreal')
  })

  it('anime emphasizes environment/background detail', () => {
    const s = buildSystemPrompt('anime', 'enhance').toLowerCase()
    expect(s).toContain('environment')
    expect(s).toContain('anime')
  })

  it('enhance vs generate differ', () => {
    expect(buildSystemPrompt('photoreal', 'enhance'))
      .not.toEqual(buildSystemPrompt('photoreal', 'generate'))
  })

  it('buildMessages puts the system prompt first and the user input last', () => {
    const msgs = buildMessages('anime', 'generate', 'a knight at dawn')
    expect(msgs[0].role).toBe('system')
    expect(msgs[msgs.length - 1].role).toBe('user')
    expect(msgs[msgs.length - 1].content).toContain('a knight at dawn')
  })
})
