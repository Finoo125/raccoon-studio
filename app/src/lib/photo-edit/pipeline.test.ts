import { describe, it, expect } from 'vitest'
import { applyEdit, placement } from './pipeline'
import { defaultEditState, type EditState, type Slice } from './types'

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

/** Map the drawn source rect through `placement`'s transform and return its bounding box. */
function footprint(sw: number, sh: number, state: EditState) {
  const p = placement(sw, sh, state)
  const cos = Math.cos(p.angle), sin = Math.sin(p.angle)
  const xs: number[] = [], ys: number[] = []
  for (const [cx, cy] of [[-sw / 2, -sh / 2], [sw / 2, -sh / 2], [sw / 2, sh / 2], [-sw / 2, sh / 2]]) {
    const x = cx * p.sx, y = cy * p.sy
    xs.push(x * cos - y * sin + p.cw / 2 + p.tx)
    ys.push(x * sin + y * cos + p.ch / 2 + p.ty)
  }
  // `+ 0` normalises -0 (float dust from the rotations) so toEqual doesn't split hairs.
  const round = (n: number) => Math.round(n * 1e6) / 1e6 + 0
  return {
    canvas: [p.cw, p.ch],
    x: [round(Math.min(...xs)), round(Math.max(...xs))],
    y: [round(Math.min(...ys)), round(Math.max(...ys))],
  }
}

describe('placement geometry', () => {
  // Regression: rotate used to scale the source into the already-swapped oriented
  // size, so a 1600x900 rotated 90° landed at x∈[-350,1250] on a 900-wide canvas —
  // squashed, clipped on both sides, blank at the bottom. Square images were fine,
  // which is why it survived: the app's own renders are often 1024².
  for (const [sw, sh] of [[1024, 1024], [1600, 900], [832, 1216]]) {
    for (const rotate of [0, 90, 180, 270] as const) {
      it(`${sw}x${sh} rotated ${rotate}° exactly fills its canvas`, () => {
        const f = footprint(sw, sh, { ...defaultEditState(), rotate })
        expect(f.canvas).toEqual(rotate === 90 || rotate === 270 ? [sh, sw] : [sw, sh])
        expect(f.x).toEqual([0, f.canvas[0]])
        expect(f.y).toEqual([0, f.canvas[1]])
      })
    }
  }

  it('a centred crop keeps the image centred and shrinks the canvas', () => {
    const state = { ...defaultEditState(), crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }
    const f = footprint(1600, 900, state)
    expect(f.canvas).toEqual([800, 450])
    expect(f.x).toEqual([-400, 1200])   // image overhangs evenly on both sides
    expect(f.y).toEqual([-225, 675])
  })

  it('an off-centre crop shifts the image, not the canvas', () => {
    const f = footprint(1600, 900, { ...defaultEditState(), crop: { x: 0, y: 0, w: 0.5, h: 1 } })
    expect(f.canvas).toEqual([800, 900])
    expect(f.x).toEqual([0, 1600])      // left edge of the source at the left edge of the canvas
    expect(f.y).toEqual([0, 900])
  })

  it('flips mirror without moving the footprint', () => {
    const f = footprint(1600, 900, { ...defaultEditState(), flipH: true, flipV: true })
    expect(f.x).toEqual([0, 1600])
    expect(f.y).toEqual([0, 900])
  })
})

describe('applyEdit local adjustments', () => {
  const grey = (n: number) => ({
    data: new Uint8ClampedArray(n * 4).fill(255).map((_, i) => (i % 4 === 3 ? 255 : 128)),
    width: n, height: 1,
  })

  const withMask = (over: Partial<EditState['masks'][number]>): EditState => ({
    ...defaultEditState(),
    masks: [{
      id: 'm', kind: 'linear', name: 'Mask', invert: false, feather: 0,
      linear: { ax: 0, ay: 0.5, bx: 1, by: 0.5 },
      adjustments: { ...defaultEditState().adjustments, exposure: 100 },
      ...over,
    }],
  })

  it('applies a masked adjustment only where the mask is opaque', () => {
    const img = grey(8)
    applyEdit(img, withMask({}))
    expect(img.data[0]).toBe(128)         // start of the gradient: untouched
    expect(img.data[7 * 4]).toBe(255)     // end: full +1 stop, clipped at white
  })

  it('a mask with no adjustments costs nothing and changes nothing', () => {
    const img = grey(8)
    applyEdit(img, withMask({ adjustments: { ...defaultEditState().adjustments } }))
    expect([...img.data].filter((_, i) => i % 4 !== 3).every((v) => v === 128)).toBe(true)
  })

  it('masks stack in order', () => {
    const state = withMask({})
    state.masks.push({
      ...state.masks[0], id: 'm2', invert: true,
      adjustments: { ...defaultEditState().adjustments, exposure: -100 },
    })
    const img = grey(8)
    applyEdit(img, state)
    expect(img.data[0]).toBe(64)          // second mask halves the untouched end
    expect(img.data[7 * 4]).toBe(255)
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
