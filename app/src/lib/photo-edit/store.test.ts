import { describe, it, expect, beforeEach } from 'vitest'
import { usePhotoEditStore } from './store'

describe('photo-edit store history', () => {
  beforeEach(() => { usePhotoEditStore.setState(usePhotoEditStore.getInitialState(), true) })
  it('setAdjustment updates and records history', () => {
    usePhotoEditStore.getState().setAdjustment('contrast', 40)
    expect(usePhotoEditStore.getState().editState.adjustments.contrast).toBe(40)
  })
  it('undo/redo navigates history', () => {
    const s = usePhotoEditStore.getState()
    s.setAdjustment('contrast', 40)
    s.endGesture()
    s.setAdjustment('contrast', 80)
    s.undo()
    expect(usePhotoEditStore.getState().editState.adjustments.contrast).toBe(40)
    s.redo()
    expect(usePhotoEditStore.getState().editState.adjustments.contrast).toBe(80)
  })
  it('a new edit after undo truncates the redo tail', () => {
    const s = usePhotoEditStore.getState()
    s.setAdjustment('contrast', 40); s.endGesture()
    s.setAdjustment('contrast', 80); s.endGesture(); s.undo()
    s.setAdjustment('contrast', 10)
    usePhotoEditStore.getState().redo()
    expect(usePhotoEditStore.getState().editState.adjustments.contrast).toBe(10)
  })

  // A range input fires per integer step: without coalescing, one drag buried the
  // undo stack under dozens of entries and undo crawled back a unit at a time.
  it('collapses a whole slider drag into one undo step', () => {
    const s = usePhotoEditStore.getState()
    for (let v = 1; v <= 40; v++) s.setAdjustment('contrast', v)
    expect(usePhotoEditStore.getState().history).toHaveLength(2)
    usePhotoEditStore.getState().undo()
    expect(usePhotoEditStore.getState().editState.adjustments.contrast).toBe(0)
  })

  it('starts a new entry when the gesture ends, or when another control moves', () => {
    const s = usePhotoEditStore.getState()
    s.setAdjustment('contrast', 40)
    s.endGesture()
    s.setAdjustment('contrast', 50)   // same slider, new gesture → new entry
    s.setAdjustment('exposure', 10)   // different slider → new entry
    expect(usePhotoEditStore.getState().history).toHaveLength(4)
  })

  it('auto-enhance is always its own undo step', () => {
    const s = usePhotoEditStore.getState()
    s.mergeAdjustments({ contrast: 20 })
    s.mergeAdjustments({ exposure: 5 })
    expect(usePhotoEditStore.getState().history).toHaveLength(3)
  })
  it('resetAll returns to defaults', () => {
    usePhotoEditStore.getState().setAdjustment('contrast', 40)
    usePhotoEditStore.getState().resetAll()
    expect(usePhotoEditStore.getState().editState.adjustments.contrast).toBe(0)
  })
})

describe('photo-edit store picker', () => {
  beforeEach(() => { usePhotoEditStore.setState(usePhotoEditStore.getInitialState(), true) })

  it('defaults pickerOpen to false', () => {
    expect(usePhotoEditStore.getState().pickerOpen).toBe(false)
  })

  it('openPicker sets pickerOpen true', () => {
    usePhotoEditStore.getState().openPicker()
    expect(usePhotoEditStore.getState().pickerOpen).toBe(true)
  })

  it('setPickerOpen(false) closes the picker (back to editor)', () => {
    usePhotoEditStore.getState().openPicker()
    usePhotoEditStore.getState().setPickerOpen(false)
    expect(usePhotoEditStore.getState().pickerOpen).toBe(false)
  })

  it('loadSource clears pickerOpen', () => {
    usePhotoEditStore.getState().openPicker()
    const bmp = { close: () => {} } as unknown as ImageBitmap
    usePhotoEditStore.getState().loadSource(bmp, { kind: 'upload', filename: 'a.png' })
    expect(usePhotoEditStore.getState().pickerOpen).toBe(false)
  })
})
