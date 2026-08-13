import { describe, it, expect } from 'vitest'
import { emptyTimeline, type DirectorShot, type DirectorTimeline } from './director-timeline'
import {
  MIN_SPAN,
  detachMedia,
  makeId,
  makeMediaClip,
  makeShot,
  moveItem,
  removeItem,
  resizeItem,
  sortedSegments,
  splitShot,
} from './timeline-edit'

const shot = (id: string, startSec: number, lengthSec: number, prompt = ''): DirectorShot =>
  ({ id, startSec, lengthSec, prompt })

/** A 15 s timeline with three 5 s shots, held out of order. */
function threeShots(): DirectorTimeline {
  return {
    ...emptyTimeline(15, 30),
    segments: [shot('c', 10, 5, 'third'), shot('a', 0, 5, 'first'), shot('b', 5, 5, 'second')],
  }
}

describe('sortedSegments', () => {
  it('orders by start time without mutating the input', () => {
    const t = threeShots()
    expect(sortedSegments(t).map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(t.segments.map((s) => s.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('makeId', () => {
  it('produces an id that is not already in the timeline', () => {
    const t = threeShots()
    const [id, next] = makeId(t, 'shot', 0)
    expect(id).toBe('shot-1')
    expect(next).toBe(1)
    expect(t.segments.some((s) => s.id === id)).toBe(false)
  })

  it('skips past ids a restored timeline already holds', () => {
    // The counter restarts at 0 on mount, but a loaded timeline can already
    // hold shot-1 and shot-2 — colliding would give two items the same React key.
    const t = { ...emptyTimeline(15, 30), segments: [shot('shot-1', 0, 5), shot('shot-2', 5, 5)] }
    const [id, next] = makeId(t, 'shot', 0)
    expect(id).toBe('shot-3')
    expect(next).toBe(3)
  })

  it('checks every lane, not just the one being added to', () => {
    const t = { ...emptyTimeline(15, 30), audio: [
      { id: 'x-1', startSec: 0, lengthSec: 1, trimStartSec: 0, file: 'a.wav' },
    ] }
    expect(makeId(t, 'x', 0)[0]).toBe('x-2')
  })
})

describe('makeShot', () => {
  it('drops a default-length block at the asked-for second', () => {
    expect(makeShot(emptyTimeline(15, 30), 'n', 4)).toMatchObject({
      startSec: 4, lengthSec: 1, prompt: '',
    })
  })

  it('starts after the block already there rather than on top of it', () => {
    const t = { ...emptyTimeline(15, 30), segments: [shot('a', 3, 4)] }
    expect(makeShot(t, 'n', 4)!.startSec).toBe(7)
  })

  it('shrinks to the gap it is dropped into', () => {
    const t = { ...emptyTimeline(15, 30), segments: [shot('a', 0, 4), shot('b', 4.5, 10)] }
    expect(makeShot(t, 'n', 4)!.lengthSec).toBeCloseTo(0.5)
  })

  it('refuses when there is no room, rather than making an ungrabbable sliver', () => {
    const t = { ...emptyTimeline(15, 30), segments: [shot('a', 0, 15)] }
    expect(makeShot(t, 'n', 7)).toBeNull()
  })

  it('carries the picture through when one is supplied', () => {
    const out = makeShot(emptyTimeline(15, 30), 'n', 0, { file: 'a.png', strength: 1, lengthSec: 3 })
    expect(out).toMatchObject({ file: 'a.png', strength: 1, lengthSec: 3 })
  })
})

describe('splitShot', () => {
  it('cuts the block under the second into two, both keeping the prompt', () => {
    const out = splitShot(threeShots(), 7, 'new')
    expect(out.segments).toHaveLength(4)
    expect(out.segments.find((s) => s.id === 'b')).toMatchObject({ startSec: 5, lengthSec: 2 })
    expect(out.segments.find((s) => s.id === 'new')).toMatchObject({
      startSec: 7, lengthSec: 3, prompt: 'second',
    })
  })

  it('leaves the picture on the left half — that is where it is pinned', () => {
    const t = { ...emptyTimeline(15, 30), segments: [{ ...shot('a', 0, 6), file: 'x.png' }] }
    const out = splitShot(t, 3, 'new')
    expect(out.segments.find((s) => s.id === 'a')!.file).toBe('x.png')
    expect(out.segments.find((s) => s.id === 'new')!.file).toBeUndefined()
  })

  it('refuses a cut outside every block, or too near an edge to leave two halves', () => {
    const t = threeShots()
    expect(splitShot(t, 5, 'new')).toBe(t) // on a boundary
    expect(splitShot(t, 5.1, 'new')).toBe(t) // inside MIN_SPAN of one
    expect(splitShot({ ...t, segments: [] }, 7, 'new').segments).toEqual([])
  })
})

describe('moveItem', () => {
  it('slides a block along its lane', () => {
    const t = { ...emptyTimeline(15, 30), segments: [shot('a', 0, 2)] }
    expect(moveItem(t, 'shots', 'a', 6).segments[0].startSec).toBe(6)
  })

  it('cannot move a block that its neighbours pen in', () => {
    // Three 5 s shots tile a 15 s clip — there is nowhere for the middle one to go.
    expect(moveItem(threeShots(), 'shots', 'b', 2).segments.find((s) => s.id === 'b')!.startSec)
      .toBe(5)
  })

  it('stops at its neighbours rather than overlapping them', () => {
    const t = threeShots()
    expect(moveItem(t, 'shots', 'b', 99).segments.find((s) => s.id === 'b')!.startSec).toBe(5) // c starts at 10
    expect(moveItem(t, 'shots', 'b', -99).segments.find((s) => s.id === 'b')!.startSec).toBe(5) // a ends at 5
  })

  it('keeps the whole block inside the render', () => {
    const t = { ...emptyTimeline(15, 30), audio: [
      { id: 'm1', startSec: 2, lengthSec: 4, trimStartSec: 0, file: 'a.wav' },
    ] }
    expect(moveItem(t, 'audio', 'm1', 14).audio[0].startSec).toBe(11) // 15 - 4
  })

  it('does not touch the other lane', () => {
    expect(moveItem(threeShots(), 'shots', 'a', 2).motion).toEqual([])
  })
})

describe('resizeItem', () => {
  const withClip = (over: Partial<DirectorTimeline['audio'][number]> = {}): DirectorTimeline => ({
    ...emptyTimeline(15, 30),
    audio: [{
      id: 'm1', startSec: 4, lengthSec: 4, trimStartSec: 1, sourceDurationSec: 10,
      file: 'a.wav', ...over,
    }],
  })

  it('drags either edge of a shot', () => {
    const t = threeShots()
    expect(resizeItem(t, 'shots', 'b', 'right', 8).segments.find((s) => s.id === 'b')!.lengthSec)
      .toBe(3)
    const head = resizeItem(t, 'shots', 'b', 'left', 7).segments.find((s) => s.id === 'b')!
    expect(head).toMatchObject({ startSec: 7, lengthSec: 3 })
  })

  it('stops a shot edge at the neighbour rather than overlapping it', () => {
    const t = threeShots()
    expect(resizeItem(t, 'shots', 'b', 'right', 99).segments.find((s) => s.id === 'b')!.lengthSec)
      .toBe(5) // c starts at 10
    expect(resizeItem(t, 'shots', 'b', 'left', 0).segments.find((s) => s.id === 'b')!.startSec)
      .toBe(5) // a ends at 5
  })

  it('trims a clip from the head, taking trimStart with it', () => {
    expect(resizeItem(withClip(), 'audio', 'm1', 'left', 6).audio[0])
      .toMatchObject({ startSec: 6, lengthSec: 2, trimStartSec: 3 })
  })

  it('will not expose material the file does not have', () => {
    // trimStart 1 s means frame 0 of the file sits at 3 s; there is nothing before it.
    expect(resizeItem(withClip(), 'audio', 'm1', 'left', 0).audio[0])
      .toMatchObject({ startSec: 3, lengthSec: 5, trimStartSec: 0 })
  })

  it('will not stretch a clip past the end of its source', () => {
    // 10 s of material, 1 s already trimmed off the head → 9 s available.
    expect(resizeItem(withClip(), 'audio', 'm1', 'right', 99).audio[0].lengthSec).toBe(9)
  })

  it('stops at the end of the render when the source is longer', () => {
    expect(resizeItem(withClip({ sourceDurationSec: 60 }), 'audio', 'm1', 'right', 99).audio[0].lengthSec)
      .toBe(11) // 15 - 4
  })

  it('keeps every block at least MIN_SPAN long', () => {
    expect(resizeItem(withClip(), 'audio', 'm1', 'right', 0).audio[0].lengthSec).toBeCloseTo(MIN_SPAN)
    expect(resizeItem(withClip(), 'audio', 'm1', 'left', 99).audio[0].startSec)
      .toBeCloseTo(8 - MIN_SPAN)
  })

  it('stretches a still-carrying shot freely — there is no source to run out of', () => {
    const t: DirectorTimeline = {
      ...emptyTimeline(15, 30),
      segments: [{ ...shot('k1', 5, 1), file: 'a.png', strength: 1 }],
    }
    expect(resizeItem(t, 'shots', 'k1', 'right', 9).segments[0].lengthSec).toBe(4)
    const left = resizeItem(t, 'shots', 'k1', 'left', 0).segments[0]
    expect(left).toMatchObject({ startSec: 0, lengthSec: 6 })
    expect(left.trimStartSec).toBeUndefined()
  })

  it('trims a shot carrying a clip like any other clip', () => {
    const t: DirectorTimeline = {
      ...emptyTimeline(15, 30),
      segments: [{
        ...shot('k1', 2, 3), file: 'clip.mp4', kind: 'video',
        strength: 1, trimStartSec: 0, sourceDurationSec: 4,
      }],
    }
    expect(resizeItem(t, 'shots', 'k1', 'right', 99).segments[0].lengthSec).toBe(4)
    expect(resizeItem(t, 'shots', 'k1', 'left', 0).segments[0])
      .toMatchObject({ startSec: 2, trimStartSec: 0 }) // nothing before frame 0 to expose
  })

  it('is a no-op for an unknown id', () => {
    const t = withClip()
    expect(resizeItem(t, 'audio', 'nope', 'right', 9)).toBe(t)
  })
})

describe('makeMediaClip', () => {
  const t = emptyTimeline(15, 30)

  it('keeps a short file at its natural length', () => {
    expect(makeMediaClip(t, 'm1', 'a.wav', 2, 4)).toEqual({
      id: 'm1', startSec: 2, lengthSec: 4, trimStartSec: 0, sourceDurationSec: 4, file: 'a.wav',
    })
  })

  it('truncates a file that would overrun the render', () => {
    expect(makeMediaClip(t, 'm1', 'a.wav', 12, 30).lengthSec).toBe(3)
  })

  it('never produces a zero-length clip at the very end', () => {
    expect(makeMediaClip(t, 'm1', 'a.wav', 15, 30).lengthSec).toBeGreaterThan(0)
  })
})

describe('removeItem', () => {
  it('drops the named block', () => {
    expect(removeItem(threeShots(), 'shots', 'b').segments.map((s) => s.id).sort())
      .toEqual(['a', 'c'])
  })

  // An empty track is the node's fast path, not an error — so there is nothing
  // to refuse, and "I cannot delete this" cannot happen.
  it('will empty the track when asked', () => {
    let t = threeShots()
    for (const id of ['a', 'b', 'c']) t = removeItem(t, 'shots', id)
    expect(t.segments).toEqual([])
  })

  it('drops media clips', () => {
    const t: DirectorTimeline = {
      ...emptyTimeline(15, 30),
      motion: [{ id: 'v1', startSec: 0, lengthSec: 2, trimStartSec: 0, file: 'v.mp4' }],
    }
    expect(removeItem(t, 'motion', 'v1').motion).toEqual([])
  })
})

describe('detachMedia', () => {
  it('takes the picture off but leaves the shot and its prompt', () => {
    const t: DirectorTimeline = {
      ...emptyTimeline(15, 30),
      segments: [{
        ...shot('a', 1, 2, 'keep me'), file: 'clip.mp4', kind: 'video', strength: 0.5,
        trimStartSec: 1, sourceDurationSec: 9, width: 100, height: 50, isEndFrame: true,
      }],
    }
    // Every media field has to go: a text block that still carried a trim would
    // keep trimming a file it no longer has.
    expect(detachMedia(t, 'a').segments[0]).toEqual({
      id: 'a', startSec: 1, lengthSec: 2, prompt: 'keep me',
    })
  })
})
