import type { MovieAsset, MovieClip, MovieTrack } from '@/types/movie'
import type { EditorState } from './editor-state'

export const selectTracks = (s: EditorState) => s.editorModel.tracks
export const selectAssets = (s: EditorState) => s.editorModel.assets
export const selectSettings = (s: EditorState) => s.editorModel.settings
export const selectProjectName = (s: EditorState) => s.editorModel.name
export const selectSelectedClipIds = (s: EditorState) => s.session.selectedClipIds
export const selectIsPlaying = (s: EditorState) => s.session.isPlaying
export const selectZoom = (s: EditorState) => s.session.zoom
export const selectSnapping = (s: EditorState) => s.session.snapping
export const selectDirty = (s: EditorState) => s.projectSync.dirty
export const selectSaving = (s: EditorState) => s.projectSync.saving
export const selectCanUndo = (s: EditorState) => s.history.undoStack.length > 0
export const selectCanRedo = (s: EditorState) => s.history.redoStack.length > 0

export interface SelectedClip {
  clip: MovieClip
  track: MovieTrack
  asset: MovieAsset | null
}

// One-entry memo: zustand v5 useStore requires getSnapshot to return a cached
// value, so this selector must not allocate on every call.
let selectedClipDeps: { id: string | undefined; tracks: MovieTrack[]; assets: MovieAsset[] } | null = null
let selectedClipResult: SelectedClip | null = null

/** First selected clip with its track and asset, or null. */
export const selectSelectedClip = (s: EditorState): SelectedClip | null => {
  const id = s.session.selectedClipIds[0]
  const { tracks, assets } = s.editorModel
  if (
    selectedClipDeps &&
    selectedClipDeps.id === id &&
    selectedClipDeps.tracks === tracks &&
    selectedClipDeps.assets === assets
  ) {
    return selectedClipResult
  }
  selectedClipDeps = { id, tracks, assets }
  selectedClipResult = null
  if (id) {
    for (const track of tracks) {
      const clip = track.clips.find((c) => c.id === id)
      if (clip) {
        const asset = assets.find((a) => a.id === clip.assetId) ?? null
        selectedClipResult = { clip, track, asset }
        break
      }
    }
  }
  return selectedClipResult
}
