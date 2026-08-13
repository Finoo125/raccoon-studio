'use client'

import { useEffect, useState } from 'react'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { SECTION_ORDER, type SectionId } from '@/lib/photo-edit/sections'
import HistogramView from './HistogramView'
import Section from './Section'
import GroupSliders from './GroupSliders'
import ToneCurveEditor from './ToneCurveEditor'
import ColorPanel from './ColorPanel'
import MasksPanel from './MasksPanel'
import FilterStrip from './FilterStrip'
import CropOverlay from './CropOverlay'
import SlicePanel from './SlicePanel'

const PREFS_KEY = 'raccoon.photo-edit.panel'

const BODY: Record<SectionId, React.ReactNode> = {
  presets: <FilterStrip />,
  light: <GroupSliders id="light" />,
  color: <ColorPanel />,
  curve: <ToneCurveEditor />,
  presence: <GroupSliders id="presence" />,
  effects: <GroupSliders id="effects" />,
  crop: <CropOverlay />,
  masks: <MasksPanel />,
  slice: <SlicePanel />,
}

/**
 * The one edit column. Every control lives here, always in the same order,
 * always reachable by scrolling — no tool has to be selected first.
 *
 * The old layout swapped the whole panel per tool, which meant the only way to
 * find out whether a tool held any edits was to open it. Sections carry that on
 * their headers instead.
 */
export default function EditPanel() {
  const openSections = usePhotoEditStore((s) => s.openSections)
  const setOpenSections = usePhotoEditStore((s) => s.setOpenSections)
  const dismissedHints = usePhotoEditStore((s) => s.dismissedHints)
  const setDismissedHints = usePhotoEditStore((s) => s.setDismissedHints)

  // Gates the writer below until the restore has run. It has to be state, not a
  // ref: both effects fire in the same commit, so a ref set by the reader is
  // already true when the writer runs — and the writer would still be closed
  // over the pre-restore `openSections`, saving the defaults over the real
  // preferences. StrictMode's second pass then reads back what it just
  // clobbered, which is how the whole panel layout was being lost on reload.
  const [restored, setRestored] = useState(false)

  // localStorage is client-only, so preferences hydrate after mount.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
      if (Array.isArray(saved.open)) setOpenSections(saved.open.filter((id: SectionId) => SECTION_ORDER.includes(id)))
      if (Array.isArray(saved.hints)) setDismissedHints(saved.hints)
    } catch { /* corrupt or unavailable — defaults are fine */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore
    setRestored(true)
  }, [setOpenSections, setDismissedHints])

  useEffect(() => {
    if (!restored) return
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ open: openSections, hints: dismissedHints }))
    } catch { /* quota or a locked-down profile */ }
  }, [openSections, dismissedHints, restored])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-3 pb-1 pt-2">
        <HistogramView />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {SECTION_ORDER.map((id) => (
          <Section key={id} id={id}>{BODY[id]}</Section>
        ))}
      </div>
    </div>
  )
}
