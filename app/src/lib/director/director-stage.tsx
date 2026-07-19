'use client'

import { createContext, useContext } from 'react'

export interface DirectorStageValue {
  /** Which studio is embedded — selects the matching canvas/inspector button. */
  kind: 'image' | 'video'
  /** Human label for the current selection target, e.g. "Opening image" / "Beat 3 of 8". */
  label: string
  /** True while a select handler is running (disables the button, shows a spinner). */
  selecting: boolean
  /** Pull the chosen output (a ComfyUI view URL) back into the Director run. */
  onSelect: (url: string) => void | Promise<void>
}

const DirectorStageContext = createContext<DirectorStageValue | null>(null)

export const DirectorStageProvider = DirectorStageContext.Provider

/** Returns the Director stage value, or null when rendered outside the Director. */
export function useDirectorStage(kind?: 'image' | 'video'): DirectorStageValue | null {
  const ctx = useContext(DirectorStageContext)
  if (!ctx) return null
  if (kind && ctx.kind !== kind) return null
  return ctx
}
