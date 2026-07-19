'use client'

import { useEffect } from 'react'
import { useEditorGetState } from './editor-store'
import { useEditorActions } from './editor-actions'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

export function useEditorKeyboard(): void {
  const getState = useEditorGetState()
  const actions = useEditorActions()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      const ctrl = e.ctrlKey || e.metaKey

      if (ctrl && e.key.toLowerCase() === 'z' && e.shiftKey) {
        e.preventDefault()
        actions.redo()
      } else if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        actions.undo()
      } else if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        actions.redo()
      } else if (e.key === ' ') {
        e.preventDefault()
        actions.setIsPlaying(!getState().session.isPlaying)
      } else if (e.key.toLowerCase() === 's' && !ctrl) {
        e.preventDefault()
        actions.splitAtPlayhead()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        actions.deleteSelection()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [actions, getState])
}
