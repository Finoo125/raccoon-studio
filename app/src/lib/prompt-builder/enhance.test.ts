import { describe, it, expect } from 'vitest'
import { buildMessages, buildSystemPrompt, buildUserMessage } from './enhance'
import { promptLengthWarning, promptLimit, ZIMAGE_PROMPT_LIMIT } from '@/lib/workflows/z-image-turbo'

describe('buildSystemPrompt', () => {
  it('asks tag models for Danbooru tags and the rest for a paragraph', () => {
    expect(buildSystemPrompt('write', 'tags')).toMatch(/Danbooru/)
    expect(buildSystemPrompt('write', 'tags')).not.toMatch(/paragraph/)
    expect(buildSystemPrompt('write', 'sentences')).toMatch(/paragraph/)
  })
  it('writes from an idea, or improves while keeping the meaning', () => {
    expect(buildSystemPrompt('write', 'sentences')).toMatch(/idea/)
    expect(buildSystemPrompt('improve', 'sentences')).toMatch(/keep every subject/i)
  })
  it('always forbids minors and asks for the bare prompt', () => {
    for (const t of ['write', 'improve'] as const) {
      expect(buildSystemPrompt(t, 'tags')).toMatch(/never describe anyone as a child/i)
      expect(buildSystemPrompt(t, 'sentences')).toMatch(/only the prompt text/)
    }
  })
  // Live 2026-10-10: named examples got copied in — sentence prompts came back
  // starting "score_9 masterpiece," and a cat became "an adult cat".
  it('names no tags or words the writer could copy into the prompt', () => {
    for (const t of ['write', 'improve'] as const) for (const st of ['sentences', 'tags'] as const) {
      expect(buildSystemPrompt(t, st, undefined, 'a cat')).not.toMatch(/score_9|masterpiece|__color__|adult/)
    }
  })
  it('asks sentence models for visible things only', () => {
    expect(buildSystemPrompt('write', 'sentences')).toMatch(/only what can be seen/)
  })
  it('names the character limit only when there is one', () => {
    expect(buildSystemPrompt('improve', 'sentences', 400)).toMatch(/under 400 characters/)
    expect(buildSystemPrompt('improve', 'sentences')).not.toMatch(/characters/)
  })
  it('keeps wildcards verbatim, only when the prompt has some', () => {
    expect(buildSystemPrompt('improve', 'sentences', undefined, 'a __hair-color__ girl in a {red|blue} dress'))
      .toMatch(/wildcards exactly as written: __hair-color__, {red|blue}/)
    expect(buildSystemPrompt('improve', 'sentences', undefined, 'a red dress')).not.toMatch(/wildcards/)
  })
  it('keeps the tags already at the start of a tag prompt', () => {
    expect(buildSystemPrompt('improve', 'tags', undefined, 'score_9, 1girl')).toMatch(/tags already at the start/)
    expect(buildSystemPrompt('write', 'sentences', undefined, 'a cat')).not.toMatch(/tags already at the start/)
  })
  it('caps tag prompts and keeps them to things in the picture', () => {
    expect(buildSystemPrompt('improve', 'tags')).toMatch(/at most 40 tags/)
  })
  it('always forbids sexual content with animals or without consent', () => {
    for (const t of ['write', 'improve'] as const) for (const st of ['sentences', 'tags'] as const) {
      expect(buildSystemPrompt(t, st)).toMatch(/never write sexual content involving animals/i)
      expect(buildSystemPrompt(t, st)).toMatch(/consent/i)
    }
  })
  it('answers in English whatever language the idea is in', () => {
    expect(buildSystemPrompt('write', 'sentences')).toMatch(/in English/)
  })
})

describe('buildUserMessage / buildMessages', () => {
  it('improve sends the prompt', () => {
    expect(buildUserMessage('improve', 'a red fox')).toBe('Prompt: a red fox\nAnswer in English.')
  })
  it('write sends the idea, plus what is already in the prompt', () => {
    expect(buildUserMessage('write', '', 'a fox')).toBe('Idea: a fox\nAnswer in English.')
    expect(buildUserMessage('write', 'at sunset', 'a fox')).toBe('Idea: a fox\nAlready in the prompt: at sunset\nAnswer in English.')
  })
  // Live 2026-10-10: qwen3.5:4b answered a German idea in German 2 of 3 times with the rule only in the system prompt.
  it('repeats the English rule where small writers look', () => {
    expect(buildUserMessage('write', '', 'eine Frau am Strand')).toMatch(/Answer in English\.$/)
  })
  it('is a system + user pair', () => {
    const m = buildMessages('write', 'tags', '', 'a fox', undefined)
    expect(m.map((x) => x.role)).toEqual(['system', 'user'])
  })
})

describe('promptLimit', () => {
  it('is Z-Image only, and drives the length warning', () => {
    expect(promptLimit('zimage')).toBe(ZIMAGE_PROMPT_LIMIT)
    expect(promptLimit('krea2')).toBeUndefined()
    expect(promptLengthWarning('zimage', 'x'.repeat(ZIMAGE_PROMPT_LIMIT + 1))).toMatch(/black image/)
    expect(promptLengthWarning('krea2', 'x'.repeat(2000))).toBeNull()
  })
})
