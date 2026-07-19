import { describe, it, expect } from 'vitest'
import { expandWildcards, hasWildcards } from './wildcards-expand'

// Deterministic rng: always picks index 0 (first option / first line).
const first = () => 0
// rng that returns a fixed fraction, to target a specific index.
const at = (f: number) => () => f

describe('expandWildcards', () => {
  it('picks one inline option', () => {
    expect(expandWildcards('a {red|blue|green} car', {}, first)).toBe('a red car')
  })
  it('picks a later option based on rng', () => {
    // 3 options, rng 0.5 -> floor(0.5*3)=1 -> "blue"
    expect(expandWildcards('{red|blue|green}', {}, at(0.5))).toBe('blue')
  })
  it('resolves nested braces inner-first', () => {
    expect(expandWildcards('{a|{b|c}}', {}, first)).toBe('a')
    expect(expandWildcards('{ {b|c}|z }', {}, first).trim()).toBe('b')
  })
  it('substitutes a __name__ list and expands the chosen entry', () => {
    const lists = { colors: ['{dark|light} blue', 'red'] }
    expect(expandWildcards('a __colors__ car', lists, first)).toBe('a dark blue car')
  })
  it('leaves an unknown __name__ token literal', () => {
    expect(expandWildcards('a __nope__ car', {}, first)).toBe('a __nope__ car')
  })
  it('terminates on self-referential lists (depth cap)', () => {
    const lists = { loop: ['__loop__'] }
    expect(() => expandWildcards('__loop__', lists, first)).not.toThrow()
  })
  it('expands a prompt with many groups completely (cap is for cycles, not size)', () => {
    const template = Array.from({ length: 60 }, () => '{a|b}').join(' ')
    expect(expandWildcards(template, {}, first)).toBe(Array.from({ length: 60 }, () => 'a').join(' '))
  })
  it('hasWildcards detects braces and tokens', () => {
    expect(hasWildcards('plain')).toBe(false)
    expect(hasWildcards('a {x|y}')).toBe(true)
    expect(hasWildcards('a __c__')).toBe(true)
  })
})
