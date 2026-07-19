import { create } from 'zustand'
import { defaultEditState, type Adjustments, type EditState, type Crop, type Slice } from './types'

type Tool = 'adjust' | 'filters' | 'crop' | 'geometry' | 'slice'
export type Origin =
  | { kind: 'gallery'; subfolder: string; filename: string }
  | { kind: 'upload'; filename: string }

interface PhotoEditStore {
  origin: Origin | null
  source: ImageBitmap | null
  editState: EditState
  history: EditState[]
  historyIndex: number
  activeTool: Tool
  saving: boolean
  /** When true, the picker is shown over a loaded image so it can be swapped. */
  pickerOpen: boolean
  loadSource: (source: ImageBitmap, origin: Origin) => void
  openPicker: () => void
  setPickerOpen: (open: boolean) => void
  setActiveTool: (t: Tool) => void
  setAdjustment: (k: keyof Adjustments, v: number) => void
  mergeAdjustments: (partial: Partial<Adjustments>) => void
  selectFilter: (id: string) => void
  setFilterIntensity: (v: number) => void
  setCrop: (c: Crop | null) => void
  setGeometry: (g: Partial<Pick<EditState, 'straighten' | 'rotate' | 'flipH' | 'flipV'>>) => void
  setSlice: (s: Slice | null) => void
  undo: () => void
  redo: () => void
  resetAll: () => void
  setSaving: (b: boolean) => void
}

function commit(state: PhotoEditStore, next: EditState): Partial<PhotoEditStore> {
  const history = state.history.slice(0, state.historyIndex + 1)
  history.push(next)
  return { editState: next, history, historyIndex: history.length - 1 }
}

export const usePhotoEditStore = create<PhotoEditStore>((set) => ({
  origin: null, source: null,
  editState: defaultEditState(),
  history: [defaultEditState()], historyIndex: 0,
  activeTool: 'adjust', saving: false,
  pickerOpen: false,
  loadSource: (source, origin) => set({
    source, origin, editState: defaultEditState(),
    history: [defaultEditState()], historyIndex: 0, activeTool: 'adjust',
    pickerOpen: false,
  }),
  openPicker: () => set({ pickerOpen: true }),
  setPickerOpen: (pickerOpen) => set({ pickerOpen }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setAdjustment: (k, v) => set((s) => commit(s, { ...s.editState, adjustments: { ...s.editState.adjustments, [k]: v } })),
  mergeAdjustments: (partial) => set((s) => commit(s, { ...s.editState, adjustments: { ...s.editState.adjustments, ...partial } })),
  selectFilter: (id) => set((s) => commit(s, { ...s.editState, filter: { id, intensity: 1 } })),
  setFilterIntensity: (intensity) => set((s) => commit(s, { ...s.editState, filter: { ...s.editState.filter, intensity } })),
  setCrop: (crop) => set((s) => commit(s, { ...s.editState, crop })),
  setGeometry: (g) => set((s) => commit(s, { ...s.editState, ...g })),
  setSlice: (slice) => set((s) => commit(s, { ...s.editState, slice })),
  undo: () => set((s) => s.historyIndex > 0 ? { historyIndex: s.historyIndex - 1, editState: s.history[s.historyIndex - 1] } : {}),
  redo: () => set((s) => s.historyIndex < s.history.length - 1 ? { historyIndex: s.historyIndex + 1, editState: s.history[s.historyIndex + 1] } : {}),
  resetAll: () => set({ editState: defaultEditState(), history: [defaultEditState()], historyIndex: 0 }),
  setSaving: (saving) => set({ saving }),
}))
