'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'
import { projectFromModel, type EditorModel } from './editor-state'
import { useEditorStoreApi } from './editor-store'
import { useEditorActions } from './editor-actions'

const AUTOSAVE_DEBOUNCE_MS = 2000

export function useAutosave(): void {
  const api = useEditorStoreApi()
  const actions = useEditorActions()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let pendingModel: EditorModel | null = null

    const save = async (model: EditorModel) => {
      pendingModel = null
      actions.markSaving()
      try {
        const res = await fetch(`/api/movies/${model.projectId}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project: projectFromModel(model) }),
        })
        if (!res.ok) throw new Error()
        actions.markSaved()
      } catch {
        actions.markSaveFailed()
        toast.error('Failed to save movie project')
      }
    }

    let lastModel = api.getState().editorModel
    const unsubscribe = api.subscribe((state) => {
      if (state.editorModel === lastModel) return
      lastModel = state.editorModel
      pendingModel = state.editorModel
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { if (pendingModel) void save(pendingModel) }, AUTOSAVE_DEBOUNCE_MS)
    })

    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
      // Flush a pending save on unmount (fire-and-forget; keepalive survives navigation)
      if (pendingModel) {
        void fetch(`/api/movies/${pendingModel.projectId}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project: projectFromModel(pendingModel) }),
          keepalive: true,
        })
      }
    }
  }, [api, actions])
}
