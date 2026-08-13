import { create } from 'zustand'
import type { Histogram } from './histogram'
import { clearSection, type SectionId } from './sections'
import {
  defaultColorWheels, defaultEditState, editorId, ZERO_ADJUSTMENTS,
  type Adjustments, type CurvePoint, type EditState, type Crop,
  type HslBand, type HueBand, type Mask, type MaskKind, type Slice, type ToneCurve,
  type WheelStop,
} from './types'

/**
 * What the canvas is doing — not which panel is showing. Every adjustment lives
 * in one always-visible column now, so the only things that need to be modal are
 * the ones that draw an overlay and change how a drag on the image is read.
 */
export type CanvasMode = 'edit' | 'crop' | 'masks' | 'slice'
export type Origin =
  | { kind: 'gallery'; subfolder: string; filename: string }
  | { kind: 'upload'; filename: string }

interface PhotoEditStore {
  origin: Origin | null
  source: ImageBitmap | null
  editState: EditState
  history: EditState[]
  historyIndex: number
  /** Identifies the control that produced the top history entry — see `commit`. */
  coalesceKey: string | null
  canvasMode: CanvasMode
  /** Section ids expanded in the edit panel. Persisted, so the layout stays put. */
  openSections: SectionId[]
  toggleSection: (id: SectionId) => void
  setOpenSections: (ids: SectionId[]) => void
  /** Hold-to-compare: shared so both the button and the keyboard can drive it. */
  comparing: boolean
  setComparing: (b: boolean) => void
  /** Reset one section back to defaults, leaving the rest of the edit alone. */
  resetSection: (id: SectionId) => void
  /** First-run hints already dismissed. Persisted alongside openSections. */
  dismissedHints: SectionId[]
  dismissHint: (id: SectionId) => void
  setDismissedHints: (ids: SectionId[]) => void
  saving: boolean
  /** When true, the picker is shown over a loaded image so it can be swapped. */
  pickerOpen: boolean
  /** Pixel aspect ratio the crop handles hold to, or null for free-form. UI mode,
   *  deliberately not part of EditState — it changes nothing about the output. */
  aspectLock: number | null
  setAspectLock: (r: number | null) => void
  /** Histogram of the last full-resolution render, published by EditorCanvas. */
  histogram: Histogram | null
  setHistogram: (h: Histogram) => void
  /** Rendered canvas width/height. Overlays use it to keep round things round. */
  canvasAspect: number
  setCanvasAspect: (a: number) => void
  loadSource: (source: ImageBitmap, origin: Origin) => void
  openPicker: () => void
  setPickerOpen: (open: boolean) => void
  setCanvasMode: (m: CanvasMode) => void
  setAdjustment: (k: keyof Adjustments, v: number) => void
  mergeAdjustments: (partial: Partial<Adjustments>) => void
  setCurve: (channel: keyof ToneCurve, points: CurvePoint[]) => void
  /** Write a saved look into the edit state (user presets are not a filter layer). */
  applyLook: (look: Pick<EditState, 'adjustments' | 'curve' | 'hsl' | 'wheels'>) => void
  setHsl: (band: HueBand, key: keyof HslBand, v: number) => void
  setWheel: (zone: 'shadows' | 'midtones' | 'highlights', stop: Partial<WheelStop>) => void
  setWheelsField: (key: 'blending' | 'balance', v: number) => void
  resetWheels: () => void
  /** Which mask the masks panel is editing. */
  selectedMaskId: string | null
  selectMask: (id: string | null) => void
  /** Brush settings — UI state shared between the panel and the canvas overlay. */
  brushRadius: number
  brushErase: boolean
  setBrush: (patch: { radius?: number; erase?: boolean }) => void
  addMask: (kind: MaskKind) => void
  updateMask: (id: string, patch: Partial<Mask>) => void
  setMaskAdjustment: (id: string, k: keyof Adjustments, v: number) => void
  removeMask: (id: string) => void
  selectFilter: (id: string) => void
  setFilterIntensity: (v: number) => void
  setCrop: (c: Crop | null) => void
  /** Crop is included so Cancel can put every geometry field back in one step —
   *  a multi-call revert would land as several separate undo entries. */
  setGeometry: (g: Partial<Pick<EditState, 'crop' | 'straighten' | 'rotate' | 'flipH' | 'flipV'>>) => void
  setSlice: (s: Slice | null) => void
  /** Call when a drag ends so the next change starts a fresh history entry. */
  endGesture: () => void
  undo: () => void
  redo: () => void
  resetAll: () => void
  setSaving: (b: boolean) => void
}

/**
 * Push `next` onto the history, or *replace* the top entry when `key` matches the
 * control that wrote it.
 *
 * A range input fires per integer step, so dragging exposure 0→40 used to push 40
 * entries and undo then crawled back one unit at a time. Coalescing by control
 * collapses a whole drag into one undoable step; `endGesture()` on pointer-up
 * clears the key so a second drag of the same slider is still its own entry.
 */
function commit(state: PhotoEditStore, next: EditState, key?: string): Partial<PhotoEditStore> {
  const history = state.history.slice(0, state.historyIndex + 1)
  if (key && key === state.coalesceKey && history.length > 1) {
    history[history.length - 1] = next
  } else {
    history.push(next)
  }
  return {
    editState: next,
    history,
    historyIndex: history.length - 1,
    coalesceKey: key ?? null,
  }
}

export const usePhotoEditStore = create<PhotoEditStore>((set) => ({
  origin: null, source: null,
  editState: defaultEditState(),
  history: [defaultEditState()], historyIndex: 0, coalesceKey: null,
  canvasMode: 'edit', openSections: ['light'], comparing: false, saving: false,
  pickerOpen: false,
  loadSource: (source, origin) => set({
    source, origin, editState: defaultEditState(),
    history: [defaultEditState()], historyIndex: 0, coalesceKey: null, canvasMode: 'edit', openSections: ['light'], comparing: false,
    pickerOpen: false, aspectLock: null, selectedMaskId: null, histogram: null,
  }),
  aspectLock: null,
  setAspectLock: (aspectLock) => set({ aspectLock }),
  histogram: null,
  setHistogram: (histogram) => set({ histogram }),
  canvasAspect: 1,
  setCanvasAspect: (canvasAspect) => set({ canvasAspect }),
  openPicker: () => set({ pickerOpen: true }),
  setPickerOpen: (pickerOpen) => set({ pickerOpen }),
  setCanvasMode: (canvasMode) => set({ canvasMode }),
  toggleSection: (id) => set((s) => ({
    openSections: s.openSections.includes(id)
      ? s.openSections.filter((x) => x !== id)
      : [...s.openSections, id],
  })),
  setOpenSections: (openSections) => set({ openSections }),
  setComparing: (comparing) => set({ comparing }),
  resetSection: (id) => set((s) => commit(s, clearSection(id, s.editState))),
  dismissedHints: [],
  dismissHint: (id) => set((s) => (s.dismissedHints.includes(id) ? s : { dismissedHints: [...s.dismissedHints, id] })),
  setDismissedHints: (dismissedHints) => set({ dismissedHints }),
  setAdjustment: (k, v) => set((s) => commit(s, { ...s.editState, adjustments: { ...s.editState.adjustments, [k]: v } }, `adjust:${k}`)),
  mergeAdjustments: (partial) => set((s) => commit(s, { ...s.editState, adjustments: { ...s.editState.adjustments, ...partial } })),
  setCurve: (channel, points) => set((s) => commit(s, { ...s.editState, curve: { ...s.editState.curve, [channel]: points } }, `curve:${channel}`)),
  applyLook: (look) => set((s) => commit(s, { ...s.editState, ...look })),
  setHsl: (band, key, v) => set((s) => commit(s, {
    ...s.editState,
    hsl: { ...s.editState.hsl, [band]: { ...s.editState.hsl[band], [key]: v } },
  }, `hsl:${band}:${key}`)),
  setWheel: (zone, stop) => set((s) => commit(s, {
    ...s.editState,
    wheels: { ...s.editState.wheels, [zone]: { ...s.editState.wheels[zone], ...stop } },
  }, `wheel:${zone}`)),
  setWheelsField: (key, v) => set((s) => commit(s, {
    ...s.editState, wheels: { ...s.editState.wheels, [key]: v },
  }, `wheels:${key}`)),
  resetWheels: () => set((s) => commit(s, { ...s.editState, wheels: defaultColorWheels() })),

  selectedMaskId: null,
  selectMask: (selectedMaskId) => set({ selectedMaskId }),
  brushRadius: 0.08,
  brushErase: false,
  setBrush: ({ radius, erase }) => set((s) => ({
    brushRadius: radius ?? s.brushRadius,
    brushErase: erase ?? s.brushErase,
  })),
  addMask: (kind) => set((s) => {
    const id = editorId('mask')
    const n = s.editState.masks.filter((m) => m.kind === kind).length + 1
    const mask: Mask = {
      id, kind, name: `${kind[0].toUpperCase()}${kind.slice(1)} ${n}`,
      invert: false, feather: 50, adjustments: { ...ZERO_ADJUSTMENTS },
      // Start each kind somewhere visible — an empty mask has nothing to grab.
      ...(kind === 'linear' ? { linear: { ax: 0.5, ay: 0.15, bx: 0.5, by: 0.85 } } : {}),
      ...(kind === 'radial' ? { radial: { cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3 } } : {}),
      ...(kind === 'brush' ? { brush: [] } : {}),
      ...(kind === 'luminance' ? { luminance: { min: 0, max: 128 } } : {}),
    }
    return { ...commit(s, { ...s.editState, masks: [...s.editState.masks, mask] }), selectedMaskId: id }
  }),
  updateMask: (id, patch) => set((s) => commit(s, {
    ...s.editState,
    masks: s.editState.masks.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  }, `mask:${id}`)),
  setMaskAdjustment: (id, k, v) => set((s) => commit(s, {
    ...s.editState,
    masks: s.editState.masks.map((m) => (m.id === id ? { ...m, adjustments: { ...m.adjustments, [k]: v } } : m)),
  }, `mask:${id}:${k}`)),
  removeMask: (id) => set((s) => ({
    ...commit(s, { ...s.editState, masks: s.editState.masks.filter((m) => m.id !== id) }),
    selectedMaskId: s.selectedMaskId === id ? null : s.selectedMaskId,
  })),
  selectFilter: (id) => set((s) => commit(s, { ...s.editState, filter: { id, intensity: 1 } })),
  setFilterIntensity: (intensity) => set((s) => commit(s, { ...s.editState, filter: { ...s.editState.filter, intensity } }, 'filter:intensity')),
  setCrop: (crop) => set((s) => commit(s, { ...s.editState, crop }, 'crop')),
  setGeometry: (g) => set((s) => commit(s, { ...s.editState, ...g }, `geometry:${Object.keys(g).join(',')}`)),
  setSlice: (slice) => set((s) => commit(s, { ...s.editState, slice }, 'slice')),
  endGesture: () => set({ coalesceKey: null }),
  undo: () => set((s) => s.historyIndex > 0 ? { historyIndex: s.historyIndex - 1, editState: s.history[s.historyIndex - 1], coalesceKey: null } : {}),
  redo: () => set((s) => s.historyIndex < s.history.length - 1 ? { historyIndex: s.historyIndex + 1, editState: s.history[s.historyIndex + 1], coalesceKey: null } : {}),
  resetAll: () => set({
    editState: defaultEditState(), history: [defaultEditState()], historyIndex: 0,
    coalesceKey: null, selectedMaskId: null, aspectLock: null,
  }),
  setSaving: (saving) => set({ saving }),
}))
