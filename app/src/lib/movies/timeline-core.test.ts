import { describe, it, expect } from 'vitest'
import type { MovieClip, MovieTrack } from '@/types/movie'
import {
  clipDuration, clipEnd, timelineDuration, clipAt, snapValue,
  resolveMove, resolveTrim, splitClip, applyCrossfade, MIN_CLIP_SEC,
} from './timeline-core'

const clip = (id: string, startSec: number, inSec: number, outSec: number, fade?: number): MovieClip =>
  ({ id, assetId: `a-${id}`, startSec, inSec, outSec, volume: 1, crossfadeWithPrevious: fade })

const track = (clips: MovieClip[]): MovieTrack => ({ id: 't1', kind: 'video', clips })

describe('basics', () => {
  it('computes duration and end', () => {
    const c = clip('c1', 10, 2, 7)
    expect(clipDuration(c)).toBe(5)
    expect(clipEnd(c)).toBe(15)
  })
  it('timelineDuration is the max clip end across tracks', () => {
    expect(timelineDuration([track([clip('a', 0, 0, 5), clip('b', 8, 0, 4)])])).toBe(12)
    expect(timelineDuration([track([])])).toBe(0)
  })
  it('clipAt returns the covering clip, preferring the later one during overlap', () => {
    const t = track([clip('a', 0, 0, 5), clip('b', 4, 0, 5, 1)])
    expect(clipAt(t, 2)?.id).toBe('a')
    expect(clipAt(t, 4.5)?.id).toBe('b')
    expect(clipAt(t, 20)).toBeUndefined()
  })
})

describe('snapValue', () => {
  it('snaps within threshold and keeps value outside it', () => {
    expect(snapValue(4.9, [5], 0.2)).toBe(5)
    expect(snapValue(4.5, [5], 0.2)).toBe(4.5)
  })
})

describe('resolveMove', () => {
  const clips = [clip('a', 0, 0, 5), clip('b', 10, 0, 5)]
  it('moves into free space', () => {
    expect(resolveMove(clips, 'b', 6)).toBe(6)
  })
  it('clamps to zero in free space', () => {
    expect(resolveMove([clip('a', 10, 0, 5)], 'a', -3)).toBe(0)
  })
  it('rejects overlapping moves', () => {
    expect(resolveMove(clips, 'b', 3)).toBeNull()
  })
  it('snaps the start edge to targets', () => {
    expect(resolveMove(clips, 'b', 5.1, [5], 0.2)).toBe(5)
  })
})

describe('resolveTrim', () => {
  const c = clip('a', 10, 2, 7) // on timeline 10..15, media 2..7 of a 20s asset
  it('start trim moves start and in-point together', () => {
    const r = resolveTrim(c, 20, 'start', 11, 0, Infinity)
    expect(r).toEqual({ startSec: 11, inSec: 3, outSec: 7 })
  })
  it('start trim cannot extend before available media', () => {
    const r = resolveTrim(c, 20, 'start', 5, 0, Infinity)
    expect(r.startSec).toBe(8) // only 2s of media before the in-point
  })
  it('end trim is clamped to media end and next clip', () => {
    expect(resolveTrim(c, 20, 'end', 40, 0, Infinity).outSec).toBe(20)
    expect(resolveTrim(c, 20, 'end', 40, 0, 12).outSec).toBe(2 + (12 - 10))
  })
  it('keeps a minimum clip length', () => {
    const r = resolveTrim(c, 20, 'end', 10, 0, Infinity)
    expect(r.outSec - r.inSec).toBeCloseTo(MIN_CLIP_SEC)
  })
  it('images trim duration without a media window', () => {
    const img = clip('i', 10, 0, 5)
    const r = resolveTrim(img, Infinity, 'start', 12, 0, Infinity)
    expect(r).toEqual({ startSec: 12, inSec: 0, outSec: 3 })
  })
})

describe('splitClip', () => {
  it('splits into two adjacent clips with continuous media', () => {
    const [l, r] = splitClip(clip('a', 10, 2, 7), 12, 'new')!
    expect(l.outSec).toBe(4)
    expect(r).toMatchObject({ id: 'new', startSec: 12, inSec: 4, outSec: 7 })
  })
  it('returns null at the edges', () => {
    expect(splitClip(clip('a', 10, 0, 5), 10, 'n')).toBeNull()
    expect(splitClip(clip('a', 10, 0, 5), 15, 'n')).toBeNull()
  })
})

describe('applyCrossfade', () => {
  const clips = [clip('a', 0, 0, 5), clip('b', 5, 0, 5)]
  it('overlaps the clip into the previous one', () => {
    const out = applyCrossfade(clips, 'b', 1)!
    const b = out.find((c) => c.id === 'b')!
    expect(b.startSec).toBe(4)
    expect(b.crossfadeWithPrevious).toBe(1)
  })
  it('removing the fade restores the abutting position', () => {
    const faded = applyCrossfade(clips, 'b', 1)!
    const out = applyCrossfade(faded, 'b', 0)!
    const b = out.find((c) => c.id === 'b')!
    expect(b.startSec).toBe(5)
    expect(b.crossfadeWithPrevious).toBeUndefined()
  })
  it('rejects a fade on the first clip', () => {
    expect(applyCrossfade(clips, 'a', 1)).toBeNull()
  })
  it('clamps the fade to the shorter neighbour', () => {
    const out = applyCrossfade([clip('a', 0, 0, 1), clip('b', 1, 0, 5)], 'b', 3)!
    const b = out.find((c) => c.id === 'b')!
    expect(b.crossfadeWithPrevious!).toBeLessThanOrEqual(1)
  })
})
