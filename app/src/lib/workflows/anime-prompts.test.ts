import { describe, it, expect } from 'vitest'
import { swapPromptPrefix, PONY_DEFAULT_POSITIVE, ANIME_DEFAULT_POSITIVE, PONY_DEFAULT_NEGATIVE, ANIME_DEFAULT_NEGATIVE } from './anime-prompts'

describe('swapPromptPrefix', () => {
  it('carries the description and swaps one family\'s tags for the other\'s', () => {
    // A scene typed under Pony, switched to Illustrious: the score ladder goes,
    // the booru tags come, the description stays.
    expect(swapPromptPrefix(`${PONY_DEFAULT_POSITIVE}a raccoon in a diner`, PONY_DEFAULT_POSITIVE, ANIME_DEFAULT_POSITIVE))
      .toBe(`${ANIME_DEFAULT_POSITIVE}a raccoon in a diner`)
  })

  it('adds tags to a plain description and strips them off again', () => {
    // SDXL base has no tags (undefined default), so both directions hinge on
    // the empty prefix.
    expect(swapPromptPrefix('a raccoon in a diner', undefined, PONY_DEFAULT_POSITIVE)).toBe(`${PONY_DEFAULT_POSITIVE}a raccoon in a diner`)
    expect(swapPromptPrefix(`${PONY_DEFAULT_POSITIVE}a raccoon in a diner`, PONY_DEFAULT_POSITIVE, undefined)).toBe('a raccoon in a diner')
    expect(swapPromptPrefix('', undefined, PONY_DEFAULT_POSITIVE)).toBe(PONY_DEFAULT_POSITIVE)
  })

  it('keeps what the user appended to a family negative', () => {
    expect(swapPromptPrefix(`${PONY_DEFAULT_NEGATIVE}, extra fingers`, PONY_DEFAULT_NEGATIVE, ANIME_DEFAULT_NEGATIVE))
      .toBe(`${ANIME_DEFAULT_NEGATIVE}, extra fingers`)
  })

  it('leaves text the user rewrote alone rather than injecting tags into it', () => {
    // No trace of the outgoing default at the front means the user took the
    // prompt over; prepending another family's tags would corrupt their text.
    expect(swapPromptPrefix('score_9, my own ladder, a raccoon', PONY_DEFAULT_POSITIVE, ANIME_DEFAULT_POSITIVE))
      .toBe('score_9, my own ladder, a raccoon')
  })
})
