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
    s.setAdjustment('contrast', 80)
    s.undo()
    expect(usePhotoEditStore.getState().editState.adjustments.contrast).toBe(40)
    s.redo()
    expect(usePhotoEditStore.getState().editState.adjustments.contrast).toBe(80)
  })
  it('a new edit after undo truncates the redo tail', () => {
    const s = usePhotoEditStore.getState()
    s.setAdjustment('contrast', 40); s.setAdjustment('contrast', 80); s.undo()
    s.setAdjustment('contrast', 10)
    usePhotoEditStore.getState().redo()
    expect(usePhotoEditStore.getState().editState.adjustments.contrast).toBe(10)
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
