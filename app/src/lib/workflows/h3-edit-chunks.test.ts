import { describe, it, expect } from 'vitest'
import {
  H3_EDIT_TOKEN_CAP, EDIT_JOIN_OVERLAP, latentFrames, editTokens, planEditChunks, type EditJoin, type EditFollow,
} from './h3-edit-chunks'
import { H3_CONTEXT_FRAMES } from './minimax-h3'

const onGrid = (f: number) => (f - 5) % 17 === 0

describe('editTokens', () => {
  it('matches the spike measurements around the cap', () => {
    expect(latentFrames(192)).toBe(57)
    expect(editTokens(192, 627)).toBe(71_478)       // 8 s @ 608x1056 rendered clean
    expect(editTokens(226, 627)).toBe(84_018)       // 9.4 s @ 608x1056 broke
    expect(editTokens(226, 432)).toBe(57_888)       // 9.4 s @ 512x864 rendered clean
    expect(editTokens(192, 627)).toBeLessThanOrEqual(H3_EDIT_TOKEN_CAP)
    expect(editTokens(226, 627)).toBeGreaterThan(H3_EDIT_TOKEN_CAP)
  })
  it('keeps the Seamless overlap equal to the continuation context', () => {
    expect(EDIT_JOIN_OVERLAP.seamless).toBe(H3_CONTEXT_FRAMES)
  })
})

describe('planEditChunks', () => {
  it('keeps a clip that fits as one part (boundary)', () => {
    expect(planEditChunks(192, 627, 'seamless')).toEqual([{ start: 0, frames: 192, overlap: 0 }])
    expect(planEditChunks(209, 627, 'seamless').length).toBe(2)
    expect(planEditChunks(226, 432, 'fast')).toEqual([{ start: 0, frames: 226, overlap: 0 }])
  })
  it('splits 15 s at the medium size into three equal-ish Seamless parts', () => {
    expect(planEditChunks(362, 627, 'seamless')).toEqual([
      { start: 0, frames: 158, overlap: 0 },
      { start: 119, frames: 141, overlap: 39 },
      { start: 221, frames: 141, overlap: 39 },
    ])
  })
  it('splits 15 s at the medium size into two Fast parts with a 5-frame pad', () => {
    expect(planEditChunks(362, 627, 'fast')).toEqual([
      { start: 0, frames: 192, overlap: 0 },
      { start: 187, frames: 175, overlap: 5 },
    ])
  })
  it('splits 9.4 s at the medium size Seamless', () => {
    expect(planEditChunks(226, 627, 'seamless')).toEqual([
      { start: 0, frames: 141, overlap: 0 },
      { start: 102, frames: 124, overlap: 39 },
    ])
  })
  it('holds its invariants for every legal length, size and join', () => {
    for (const cells of [405, 432, 627, 646, 720]) {
      for (const join of ['seamless', 'fast'] as EditJoin[]) {
        for (let total = 56; total <= 362; total += 17) {
          const plan = planEditChunks(total, cells, join)
          const fits = editTokens(total, cells) <= H3_EDIT_TOKEN_CAP
          expect(plan.length === 1, `${total}@${cells}/${join}`).toBe(fits)
          let end = 0
          plan.forEach((c, i) => {
            expect(onGrid(c.frames)).toBe(true)
            expect(editTokens(c.frames, cells)).toBeLessThanOrEqual(H3_EDIT_TOKEN_CAP)
            expect(c.overlap).toBe(i === 0 ? 0 : EDIT_JOIN_OVERLAP[join])
            expect(c.start).toBe(i === 0 ? 0 : end - c.overlap)
            expect(c.frames).toBeGreaterThan(c.overlap)
            end = c.start + c.frames
          })
          expect(end).toBe(total)
          const lens = plan.map((c) => c.frames)
          expect(Math.max(...lens) - Math.min(...lens)).toBeLessThanOrEqual(17)
          // Minimal: one part fewer could not hold the clip under the cap.
          if (plan.length > 1) {
            // n−1 parts of the largest legal size could not reach `total`.
            const kMax = Math.floor((H3_EDIT_TOKEN_CAP / (2 * cells) - 2) / 5)
            const q = (EDIT_JOIN_OVERLAP[join] - 5) / 17
            expect((plan.length - 1) * kMax).toBeLessThan((total - 5) / 17 + q * (plan.length - 2))
          }
        }
      }
    }
  })
})

describe('pictures', () => {
  it('cost one frame of cells each', () => {
    expect(editTokens(192, 627, 1)).toBe(72_105)        // rendered clean in the spike
    expect(planEditChunks(192, 627, 'seamless', 1).length).toBe(1)
    expect(planEditChunks(192, 627, 'seamless', 2).length).toBe(2)
  })
  it('keep every part under the cap', () => {
    for (const pictures of [0, 1, 2, 3]) {
      for (let total = 56; total <= 362; total += 17) {
        for (const c of planEditChunks(total, 627, 'seamless', pictures)) {
          expect(editTokens(c.frames, 627, pictures)).toBeLessThanOrEqual(H3_EDIT_TOKEN_CAP)
        }
      }
    }
  })
})

describe('loose', () => {
  it('costs a quarter of the anchored copy for its half-size reference', () => {
    expect(editTokens(192, 627, 1, 'loose')).toBe(Math.ceil(1.25 * 57 * 627) + 627)   // the spike's clean half-size render
    expect(editTokens(192, 627, 0, 'exact')).toBe(editTokens(192, 627))
  })
  it('loose parts are longer', () => {
    expect(planEditChunks(277, 627, 'seamless', 0, 'loose').length).toBe(1)          // 12 s in one go
    expect(planEditChunks(277, 627, 'seamless', 0, 'exact').length).toBe(2)
    const loose = planEditChunks(362, 627, 'seamless', 0, 'loose')
    expect(loose.length).toBeLessThan(planEditChunks(362, 627, 'seamless', 0, 'exact').length)
    for (const c of loose) expect(editTokens(c.frames, 627, 0, 'loose')).toBeLessThanOrEqual(H3_EDIT_TOKEN_CAP)
  })
  it('holds the invariants for loose too', () => {
    for (const follow of ['exact', 'loose'] as EditFollow[]) {
      for (let total = 56; total <= 362; total += 17) {
        let end = 0
        for (const c of planEditChunks(total, 720, 'seamless', 2, follow)) {
          expect(editTokens(c.frames, 720, 2, follow)).toBeLessThanOrEqual(H3_EDIT_TOKEN_CAP)
          end = c.start + c.frames
        }
        expect(end).toBe(total)
      }
    }
  })
})
