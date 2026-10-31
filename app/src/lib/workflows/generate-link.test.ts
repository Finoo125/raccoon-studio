import { describe, expect, it } from 'vitest'
import { presetOnlyLink } from './generate-link'

const q = (s: string) => new URLSearchParams(s)

describe('presetOnlyLink', () => {
  it('a link naming only a preset restores the session, then switches (Simple Models "Make a picture")', () => {
    expect(presetOnlyLink(q('workflow=krea2-turbo'))).toBe('krea2-turbo')
  })
  it('a gallery Edit link (?ref=) does the same', () => {
    expect(presetOnlyLink(q('workflow=qwen21-edit&ref=/x.png&chip=sheet'))).toBe('qwen21-edit')
  })
  it('a link carrying settings replaces the session instead', () => {
    for (const k of ['prompt', 'negative', 'seed', 'loras']) expect(presetOnlyLink(q(`workflow=anima&${k}=x`))).toBeNull()
  })
  it('no preset, no link', () => {
    expect(presetOnlyLink(q('prompt=a cat'))).toBeNull()
    expect(presetOnlyLink(q(''))).toBeNull()
  })
})
