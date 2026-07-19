import { describe, it, expect } from 'vitest'
import { buildAssemblyClips } from './assembly'

describe('buildAssemblyClips', () => {
  it('lays clips end-to-end with cumulative startSec and full in/out', () => {
    const clips = buildAssemblyClips([
      { assetId: 'a', durationSec: 15 },
      { assetId: 'b', durationSec: 12 },
      { assetId: 'c', durationSec: 15 },
    ])
    expect(clips.map((c) => c.startSec)).toEqual([0, 15, 27])
    expect(clips.map((c) => c.outSec)).toEqual([15, 12, 15])
    expect(clips.every((c) => c.inSec === 0 && c.volume === 1)).toBe(true)
    expect(clips.map((c) => c.assetId)).toEqual(['a', 'b', 'c'])
    // ids are unique
    expect(new Set(clips.map((c) => c.id)).size).toBe(3)
  })

  it('returns [] for no inputs', () => {
    expect(buildAssemblyClips([])).toEqual([])
  })
})
