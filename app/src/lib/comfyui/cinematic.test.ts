import { describe, it, expect } from 'vitest'
import { parseSseBuffer, enhanceReducer, initialEnhanceState } from './cinematic'

describe('parseSseBuffer', () => {
  it('parses complete data: events and returns the partial remainder', () => {
    const buf =
      'data: {"type":"status","msg":"Generating..."}\n\n' +
      'data: {"type":"delta","text":"Hello"}\n\n' +
      'data: {"type":"delta","text":" world'
    const { events, rest } = parseSseBuffer(buf)
    expect(events).toEqual([
      { type: 'status', msg: 'Generating...' },
      { type: 'delta', text: 'Hello' },
    ])
    expect(rest).toBe('data: {"type":"delta","text":" world')
  })

  it('ignores unparseable blocks but keeps going', () => {
    const buf = 'data: not json\n\ndata: {"type":"done"}\n\n'
    const { events, rest } = parseSseBuffer(buf)
    expect(events).toEqual([{ type: 'done' }])
    expect(rest).toBe('')
  })
})

describe('enhanceReducer', () => {
  it('accumulates delta text and tracks status', () => {
    let s = enhanceReducer(initialEnhanceState, { type: 'status', msg: 'Generating...' })
    s = enhanceReducer(s, { type: 'delta', text: 'Hello' })
    s = enhanceReducer(s, { type: 'delta', text: ' world' })
    expect(s.status).toBe('Generating...')
    expect(s.promptText).toBe('Hello world')
  })

  it('reset (local-only event) restores the initial state between runs', () => {
    let s = enhanceReducer(initialEnhanceState, { type: 'delta', text: 'draft' })
    s = enhanceReducer(s, { type: 'error', msg: 'boom' })
    s = enhanceReducer(s, { type: 'reset' })
    expect(s).toEqual(initialEnhanceState)
  })

  it('done with a finalized prompt replaces the accumulated deltas', () => {
    let s = enhanceReducer(initialEnhanceState, { type: 'delta', text: 'raw draft' })
    s = enhanceReducer(s, { type: 'done', prompt: 'ANCHOR.\nraw draft' })
    expect(s.promptText).toBe('ANCHOR.\nraw draft')
  })

  it('done without a prompt keeps the accumulated deltas', () => {
    let s = enhanceReducer(initialEnhanceState, { type: 'delta', text: 'raw draft' })
    s = enhanceReducer(s, { type: 'done' })
    expect(s.promptText).toBe('raw draft')
  })

  it('ignores the timeline event (and other unknown events) without changing state', () => {
    const s = enhanceReducer(initialEnhanceState, { type: 'timeline', beats: [1, 2, 3] })
    expect(s).toEqual(initialEnhanceState)
  })

  it('records errors', () => {
    const s = enhanceReducer(initialEnhanceState, { type: 'error', msg: 'Ollama not reachable' })
    expect(s.error).toBe('Ollama not reachable')
  })
})
