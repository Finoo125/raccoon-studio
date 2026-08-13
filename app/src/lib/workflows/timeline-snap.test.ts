import { describe, it, expect } from 'vitest'
import { snapSec, shotAt, fitZoom } from './timeline-snap'

describe('fitZoom', () => {
  it('makes the clip exactly fill the track', () => {
    expect(fitZoom(1400, 10)).toBe(140)
    expect(fitZoom(1400, 10) * 10).toBe(1400)
  })

  it('gives a longer clip a tighter scale, so both still fill the width', () => {
    expect(fitZoom(1400, 30)).toBeLessThan(fitZoom(1400, 10))
    expect(fitZoom(1400, 30) * 30).toBeCloseTo(1400)
  })

  it('falls back to 70 px/s before the track has been measured', () => {
    expect(fitZoom(0, 15)).toBe(70)
    expect(fitZoom(-1, 15)).toBe(70)
  })

  it('falls back rather than dividing by a zero duration', () => {
    expect(fitZoom(1400, 0)).toBe(70)
  })
})

describe('snapSec', () => {
  const opts = { zoom: 70, thresholdPx: 8 } // 8px at 70px/s ≈ 0.114s

  it('snaps to the nearest target inside the threshold', () => {
    expect(snapSec(4.05, [2, 4, 6], opts)).toBe(4)
  })

  it('leaves the value alone when nothing is near', () => {
    expect(snapSec(5, [2, 4, 6], opts)).toBe(5)
  })

  it('picks the closest of two targets that both qualify', () => {
    expect(snapSec(4.06, [4, 4.1], opts)).toBe(4.1)
  })

  it('ignores targets scrolled out of view', () => {
    // 4 would win, but the visible span starts after it.
    expect(snapSec(4.02, [4, 9], { ...opts, viewStartSec: 5, viewEndSec: 15 })).toBe(4.02)
  })

  it('scales the threshold with zoom — zoomed out snaps over a wider span', () => {
    // At 10px/s, 8px is 0.8s, so a 0.5s gap now snaps where it did not at 70px/s.
    expect(snapSec(4.5, [4], opts)).toBe(4.5)
    expect(snapSec(4.5, [4], { ...opts, zoom: 10 })).toBe(4)
  })

  it('is a no-op for a degenerate zoom rather than dividing by zero', () => {
    expect(snapSec(4.5, [4], { zoom: 0 })).toBe(4.5)
  })
})

describe('shotAt', () => {
  const segs = [
    { id: 'c', startSec: 8, lengthSec: 4 },
    { id: 'a', startSec: 0, lengthSec: 4 },
    { id: 'b', startSec: 4, lengthSec: 4 },
  ]

  it('finds the covering shot regardless of array order', () => {
    expect(shotAt(segs, 5)?.id).toBe('b')
  })

  it('treats a boundary as belonging to the shot that starts there', () => {
    expect(shotAt(segs, 4)?.id).toBe('b')
  })

  it('returns the opening shot at zero', () => {
    expect(shotAt(segs, 0)?.id).toBe('a')
  })

  // Shots no longer tile the clip: the stretches between and after them run on
  // the global prompt alone, so there is nothing to report there.
  it('returns undefined past the last shot', () => {
    expect(shotAt(segs, 99)).toBeUndefined()
  })

  it('returns undefined inside a gap, and before the first shot', () => {
    const gapped = [{ id: 'x', startSec: 2, lengthSec: 1 }, { id: 'y', startSec: 6, lengthSec: 1 }]
    expect(shotAt(gapped, 1)).toBeUndefined()
    expect(shotAt(gapped, 4)).toBeUndefined()
    expect(shotAt(gapped, 6.5)?.id).toBe('y')
  })
})
