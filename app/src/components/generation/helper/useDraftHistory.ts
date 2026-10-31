'use client'

import { useEffect, useRef, useState } from 'react'

const HISTORY = 30

/**
 * The Prompt Helper's draft with its undo history: every helper action is one
 * step, and so is each burst of typing.
 */
export function useDraftHistory(initial: string) {
  const [draft, setDraft] = useState(initial)
  const [past, setPast] = useState<string[]>([])
  // The draft as it is NOW, for results that land after the user kept typing.
  const latest = useRef(draft)
  useEffect(() => { latest.current = draft }, [draft])
  // Typing pushes one history step per burst: set by a keystroke, cleared by any helper action.
  const typing = useRef(false)

  /** Every helper action: one undo step holding what it replaces. */
  const change = (next: string) => {
    typing.current = false
    const cur = latest.current
    if (next === cur) return
    setPast((p) => [...p.slice(-(HISTORY - 1)), cur])
    setDraft(next)
  }
  const typeInto = (next: string) => {
    if (!typing.current) setPast((p) => [...p.slice(-(HISTORY - 1)), latest.current])
    typing.current = true
    setDraft(next)
  }
  const undo = () => {
    const prev = past.at(-1)
    if (prev === undefined) return
    typing.current = false
    setPast((p) => p.slice(0, -1))
    setDraft(prev)
  }

  return { draft, latest, change, typeInto, undo, canUndo: past.length > 0 }
}
