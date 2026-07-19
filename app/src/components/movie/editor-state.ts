import type { MovieAsset, MovieProject, MovieSettings, MovieTrack } from '@/types/movie'

export interface EditorModel {
  projectId: string
  name: string
  createdAt: string
  settings: MovieSettings
  assets: MovieAsset[]
  tracks: MovieTrack[]
}

export interface EditorSession {
  selectedClipIds: string[]
  playheadSec: number
  isPlaying: boolean
  /** Pixels per second */
  zoom: number
  snapping: boolean
}

export interface EditorSnapshot {
  assets: MovieAsset[]
  tracks: MovieTrack[]
}

export interface EditorHistory {
  undoStack: EditorSnapshot[]
  redoStack: EditorSnapshot[]
}

export interface ProjectSync {
  dirty: boolean
  saving: boolean
  lastSavedAt: string | null
}

export interface EditorState {
  editorModel: EditorModel
  session: EditorSession
  history: EditorHistory
  projectSync: ProjectSync
}

export const MAX_UNDO = 50

export function initialEditorState(project: MovieProject): EditorState {
  return {
    editorModel: {
      projectId: project.id,
      name: project.name,
      createdAt: project.createdAt,
      settings: project.settings,
      assets: project.assets,
      tracks: project.tracks,
    },
    session: { selectedClipIds: [], playheadSec: 0, isPlaying: false, zoom: 60, snapping: true },
    history: { undoStack: [], redoStack: [] },
    projectSync: { dirty: false, saving: false, lastSavedAt: null },
  }
}

/** Rebuild a MovieProject document for persistence. */
export function projectFromModel(model: EditorModel): MovieProject {
  return {
    id: model.projectId,
    name: model.name,
    createdAt: model.createdAt,
    modifiedAt: new Date().toISOString(),
    settings: model.settings,
    assets: model.assets,
    tracks: model.tracks,
  }
}
