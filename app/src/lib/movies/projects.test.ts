import { describe, it, expect } from 'vitest'
import { projectDir, assetsDir, deleteProject } from './projects'

describe('project id guard', () => {
  it('rejects path-like ids before they reach a filesystem path', () => {
    expect(() => projectDir('..')).toThrow(/invalid project id/i)
    expect(() => projectDir('../../etc')).toThrow(/invalid project id/i)
    expect(() => assetsDir('a/b')).toThrow(/invalid project id/i)
    expect(() => deleteProject('..')).toThrow(/invalid project id/i)
    expect(() => projectDir('0f8b7c1a-1111-2222-3333-444455556666')).not.toThrow()
  })
})
