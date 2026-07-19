'use client'

import { createContext, useContext, useState } from 'react'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { MovieProject } from '@/types/movie'
import { initialEditorState, type EditorState } from './editor-state'

export type EditorStore = StoreApi<EditorState>

const EditorStoreContext = createContext<EditorStore | null>(null)

export function EditorStoreProvider({
  project,
  children,
}: {
  project: MovieProject
  children: React.ReactNode
}) {
  const [store] = useState<EditorStore>(() => createStore<EditorState>()(() => initialEditorState(project)))
  return <EditorStoreContext.Provider value={store}>{children}</EditorStoreContext.Provider>
}

export function useEditorStoreApi(): EditorStore {
  const api = useContext(EditorStoreContext)
  if (!api) throw new Error('useEditorStoreApi must be used inside EditorStoreProvider')
  return api
}

export function useEditorStore<T>(selector: (s: EditorState) => T): T {
  return useStore(useEditorStoreApi(), selector)
}

/** Lazy state access for imperative code (rAF loops, window listeners). */
export function useEditorGetState(): () => EditorState {
  return useEditorStoreApi().getState
}
