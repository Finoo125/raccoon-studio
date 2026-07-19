import { v4 as uuid } from 'uuid'
import { useMemo } from 'react'
import type { MovieAsset, MovieClip } from '@/types/movie'
import {
  applyCrossfade, clipAt, clipEnd, resolveMove, resolveTrim, snapTargets,
  sortClips, splitClip,
} from '@/lib/movies/timeline-core'
import { DEFAULT_IMAGE_CLIP_SEC } from '@/types/movie'
import { MAX_UNDO, type EditorModel, type EditorSnapshot } from './editor-state'
import { useEditorStoreApi, type EditorStore } from './editor-store'

const SNAP_PX = 8

export function createEditorActions(api: EditorStore) {
  const set = api.setState
  const get = api.getState

  const currentSnapshot = (): EditorSnapshot => ({
    assets: get().editorModel.assets,
    tracks: get().editorModel.tracks,
  })

  /** Apply a document mutation: records undo history + marks dirty. */
  const mutate = (fn: (model: EditorModel) => Partial<EditorModel> | null): boolean => {
    const s = get()
    const patch = fn(s.editorModel)
    if (!patch) return false
    set({
      editorModel: { ...s.editorModel, ...patch },
      history: {
        undoStack: [...s.history.undoStack.slice(-(MAX_UNDO - 1)), currentSnapshot()],
        redoStack: [],
      },
      projectSync: { ...s.projectSync, dirty: true },
    })
    return true
  }

  const findTrackOf = (model: EditorModel, clipId: string) =>
    model.tracks.find((t) => t.clips.some((c) => c.id === clipId))

  const replaceClips = (model: EditorModel, trackId: string, clips: MovieClip[]) =>
    model.tracks.map((t) => (t.id === trackId ? { ...t, clips: sortClips(clips) } : t))

  return {
    // ---- document mutations (undoable)
    addAsset: (asset: MovieAsset) =>
      mutate((m) => (m.assets.some((a) => a.path === asset.path)
        ? null
        : { assets: [...m.assets, asset] })),

    addClipFromAsset: (assetId: string, trackId: string, startSec: number): boolean =>
      mutate((m) => {
        const asset = m.assets.find((a) => a.id === assetId)
        const track = m.tracks.find((t) => t.id === trackId)
        if (!asset || !track || asset.offline) return null
        if (track.kind === 'audio' && asset.kind === 'image') return null
        if (track.kind === 'video' && asset.kind === 'audio') return null
        const dur = asset.kind === 'image' ? DEFAULT_IMAGE_CLIP_SEC : asset.durationSec
        if (dur <= 0) return null
        const clip: MovieClip = {
          id: uuid(), assetId, startSec: Math.max(0, startSec), inSec: 0, outSec: dur, volume: 1,
        }
        const all = [...track.clips, clip]
        const placed = resolveMove(all, clip.id, clip.startSec)
        if (placed === null) return null
        clip.startSec = placed
        return { tracks: replaceClips(m, trackId, all) }
      }),

    moveClip: (clipId: string, desiredStart: number): boolean =>
      mutate((m) => {
        const track = findTrackOf(m, clipId)
        if (!track) return null
        const session = get().session
        const targets = session.snapping
          ? snapTargets(m.tracks, clipId, session.playheadSec)
          : []
        const start = resolveMove(track.clips, clipId, desiredStart, targets, SNAP_PX / session.zoom)
        if (start === null) return null
        return {
          tracks: replaceClips(
            m, track.id,
            track.clips.map((c) =>
              c.id === clipId ? { ...c, startSec: start, crossfadeWithPrevious: undefined } : c,
            ),
          ),
        }
      }),

    trimClip: (clipId: string, edge: 'start' | 'end', desiredTimelineSec: number): boolean =>
      mutate((m) => {
        const track = findTrackOf(m, clipId)
        if (!track) return null
        const sorted = sortClips(track.clips)
        const idx = sorted.findIndex((c) => c.id === clipId)
        const clip = sorted[idx]
        const asset = m.assets.find((a) => a.id === clip.assetId)
        if (!asset) return null
        const prevEnd = idx > 0 ? clipEnd(sorted[idx - 1]) : 0
        const nextStart = sorted[idx + 1]?.startSec ?? Infinity
        const r = resolveTrim(
          clip,
          asset.kind === 'image' ? Infinity : asset.durationSec,
          edge, desiredTimelineSec, prevEnd, nextStart,
        )
        return {
          tracks: replaceClips(
            m, track.id,
            track.clips.map((c) =>
              c.id === clipId
                ? { ...c, ...r, crossfadeWithPrevious: edge === 'start' ? undefined : c.crossfadeWithPrevious }
                : c,
            ),
          ),
        }
      }),

    splitAtPlayhead: () =>
      mutate((m) => {
        const { playheadSec, selectedClipIds } = get().session
        let changed = false
        const tracks = m.tracks.map((track) => {
          const target = clipAt(track, playheadSec)
          if (!target) return track
          if (selectedClipIds.length > 0 && !selectedClipIds.includes(target.id)) return track
          const parts = splitClip(target, playheadSec, uuid())
          if (!parts) return track
          changed = true
          return { ...track, clips: sortClips([...track.clips.filter((c) => c.id !== target.id), ...parts]) }
        })
        return changed ? { tracks } : null
      }),

    deleteSelection: () =>
      mutate((m) => {
        const ids = new Set(get().session.selectedClipIds)
        if (ids.size === 0) return null
        return { tracks: m.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !ids.has(c.id)) })) }
      }),

    setClipVolume: (clipId: string, volume: number) =>
      mutate((m) => {
        const track = findTrackOf(m, clipId)
        if (!track) return null
        return {
          tracks: replaceClips(
            m, track.id,
            track.clips.map((c) => (c.id === clipId ? { ...c, volume: Math.min(1, Math.max(0, volume)) } : c)),
          ),
        }
      }),

    setCrossfade: (clipId: string, durationSec: number): boolean =>
      mutate((m) => {
        const track = findTrackOf(m, clipId)
        if (!track) return null
        const clips = applyCrossfade(track.clips, clipId, durationSec)
        if (!clips) return null
        return { tracks: replaceClips(m, track.id, clips) }
      }),

    // ---- session (not undoable)
    selectClips: (ids: string[]) =>
      set((s) => ({ session: { ...s.session, selectedClipIds: ids } })),
    setPlayhead: (sec: number) =>
      set((s) => ({ session: { ...s.session, playheadSec: Math.max(0, sec) } })),
    setIsPlaying: (playing: boolean) =>
      set((s) => ({ session: { ...s.session, isPlaying: playing } })),
    setZoom: (zoom: number) =>
      set((s) => ({ session: { ...s.session, zoom: Math.min(400, Math.max(8, zoom)) } })),
    toggleSnapping: () =>
      set((s) => ({ session: { ...s.session, snapping: !s.session.snapping } })),

    // ---- history
    undo: () => {
      const s = get()
      const prev = s.history.undoStack[s.history.undoStack.length - 1]
      if (!prev) return
      set({
        editorModel: { ...s.editorModel, assets: prev.assets, tracks: prev.tracks },
        history: {
          undoStack: s.history.undoStack.slice(0, -1),
          redoStack: [...s.history.redoStack, { assets: s.editorModel.assets, tracks: s.editorModel.tracks }],
        },
        projectSync: { ...s.projectSync, dirty: true },
        session: { ...s.session, selectedClipIds: [] },
      })
    },
    redo: () => {
      const s = get()
      const next = s.history.redoStack[s.history.redoStack.length - 1]
      if (!next) return
      set({
        editorModel: { ...s.editorModel, assets: next.assets, tracks: next.tracks },
        history: {
          undoStack: [...s.history.undoStack, { assets: s.editorModel.assets, tracks: s.editorModel.tracks }],
          redoStack: s.history.redoStack.slice(0, -1),
        },
        projectSync: { ...s.projectSync, dirty: true },
        session: { ...s.session, selectedClipIds: [] },
      })
    },

    // ---- sync bookkeeping
    markSaving: () => set((s) => ({ projectSync: { ...s.projectSync, saving: true } })),
    markSaved: () =>
      set(() => ({
        projectSync: { dirty: false, saving: false, lastSavedAt: new Date().toISOString() },
      })),
    markSaveFailed: () => set((s) => ({ projectSync: { ...s.projectSync, saving: false } })),
  }
}

export type EditorActions = ReturnType<typeof createEditorActions>

export function useEditorActions(): EditorActions {
  const api = useEditorStoreApi()
  return useMemo(() => createEditorActions(api), [api])
}
