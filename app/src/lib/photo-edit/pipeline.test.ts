import { describe, it, expect } from 'vitest'
import { applyEdit } from './pipeline'
import { defaultEditState, type Slice } from './types'

const img = () => ({ data: new Uint8ClampedArray([100,150,200,255]), width: 1, height: 1 })

describe('applyEdit', () => {
  it('default edit is identity', () => {
    const i = img(); applyEdit(i, defaultEditState())
    expect([...i.data]).toEqual([100,150,200,255])
  })
  it('applies the selected preset bundle', () => {
    const i = img()
    const s = defaultEditState(); s.filter = { id: 'mono', intensity: 1 }
    applyEdit(i, s)
    expect(i.data[0]).toBe(i.data[1]) // mono => grayscale
    expect(i.data[1]).toBe(i.data[2])
  })
})

// 4 horizontal pixels in a row, all opaque red.
const row = () => ({
  data: new Uint8ClampedArray([
    255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
  ]),
  width: 4,
  height: 1,
})

describe('applyEdit slice masking', () => {
  // Vertical line at x=0.5: keep 'a' (cross >= 0) keeps the LEFT half.
  const verticalLine: Slice = { ax: 0.5, ay: 0, bx: 0.5, by: 1, keep: 'a' }

  it('keep "a" zeroes alpha on the right of a vertical line', () => {
    const i = row()
    const s = defaultEditState(); s.slice = verticalLine
    applyEdit(i, s)
    expect(i.data[3]).toBe(255)   // x=0 left → kept
    expect(i.data[7]).toBe(255)   // x=1 left → kept
    expect(i.data[11]).toBe(0)    // x=2 right → cleared
    expect(i.data[15]).toBe(0)    // x=3 right → cleared
  })

  it('keep "b" zeroes the opposite side', () => {
    const i = row()
    const s = defaultEditState(); s.slice = { ...verticalLine, keep: 'b' }
    applyEdit(i, s)
    expect(i.data[3]).toBe(0)     // left cleared
    expect(i.data[15]).toBe(255)  // right kept
  })

  it('no slice leaves alpha untouched', () => {
    const i = row()
    applyEdit(i, defaultEditState())
    expect([i.data[3], i.data[7], i.data[11], i.data[15]]).toEqual([255, 255, 255, 255])
  })
})
