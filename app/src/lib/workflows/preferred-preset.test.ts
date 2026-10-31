import { describe, expect, it } from 'vitest'
import { preferredPreset } from './preferred-preset'

const has = (...ids: string[]) => (id: string) => ids.includes(id)

describe('preferredPreset', () => {
  it('keeps the current preset when it can run', () => {
    expect(preferredPreset('anima', ['krea2-turbo', 'anima'], has('anima', 'krea2-turbo'), 'anima-turbo')).toBeNull()
  })
  it('moves to the first preset in order that can run', () => {
    expect(preferredPreset('anima', ['krea2-turbo', 'anima-turbo', 'anima'], has('anima-turbo'), 'anima-turbo')).toBe('anima-turbo')
  })
  it('moves to the recommended starter when nothing can run (its Download button takes over)', () => {
    expect(preferredPreset('anima', ['krea2-turbo'], has(), 'anima-turbo')).toBe('anima-turbo')
  })
  it('stays put when nothing can run and it is already on the starter', () => {
    expect(preferredPreset('anima-turbo', ['krea2-turbo'], has(), 'anima-turbo')).toBeNull()
  })
})
