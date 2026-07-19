import { describe, it, expect } from 'vitest'
import path from 'path'
import { resolveWithinRoot, nextCopyName } from './route'

describe('save helpers', () => {
  it('rejects path traversal', () => {
    expect(resolveWithinRoot('/out', '../etc', 'x.png')).toBeNull()
  })
  it('resolves a safe path', () => {
    expect(resolveWithinRoot('/out', 'sub', 'a.png')).toBe(path.resolve('/out', 'sub', 'a.png'))
  })
  it('increments copy name on collision', () => {
    const exists = (p: string) => p.endsWith('a_edited.png')
    expect(nextCopyName('/out', '', 'a.png', 'png', exists)).toBe('a_edited-2.png')
  })
})
