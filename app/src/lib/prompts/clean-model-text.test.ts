import { describe, it, expect } from 'vitest'
import { cleanModelText } from './clean-model-text'

describe('cleanModelText', () => {
  it('drops a closed think block and keeps the answer', () => {
    expect(cleanModelText('<think>plan it</think>\nA red fox in snow')).toBe('A red fox in snow')
  })
  it('returns nothing for an unclosed think block', () => {
    expect(cleanModelText('<think>still thinking about')).toBe('')
  })
  it('drops a preamble, a Prompt: label and wrapping quotes', () => {
    expect(cleanModelText('Here is your prompt: "A red fox"')).toBe('A red fox')
    expect(cleanModelText('Prompt: A red fox')).toBe('A red fox')
    expect(cleanModelText('**Prompt:** A red fox')).toBe('A red fox')
  })
  it('keeps the first paragraph only, skipping a heading line', () => {
    expect(cleanModelText('Result:\n\nA red fox\n\nHope this helps!')).toBe('A red fox')
  })
  it('treats refusals and step-by-step reasoning as nothing', () => {
    expect(cleanModelText("I'm sorry, I can't help with that.")).toBe('')
    expect(cleanModelText('Step 1: pick a subject')).toBe('')
  })
  it('never truncates', () => {
    const long = 'word '.repeat(300).trim()
    expect(cleanModelText(long)).toBe(long)
  })
})

describe('cleanModelText — markdown wrapper', () => {
  // Live 2026-10-10: the built-in writer wrapped a whole prompt in _…_ (markdown italics).
  it('drops one markdown emphasis pair around the whole answer', () => {
    expect(cleanModelText('_a woman on a beach at sunset_')).toBe('a woman on a beach at sunset')
    expect(cleanModelText('**a woman on a beach**')).toBe('a woman on a beach')
    expect(cleanModelText('1girl, solo, no_humans')).toBe('1girl, solo, no_humans')
  })
})
