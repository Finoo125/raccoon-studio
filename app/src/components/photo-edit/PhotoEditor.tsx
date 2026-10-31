'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { galleryOriginMatches, startGalleryLoad } from '@/lib/photo-edit/deep-link'
import ImagePicker from './ImagePicker'
import EditorCanvas from './EditorCanvas'
import TopBar from './TopBar'
import EditPanel from './EditPanel'
import { SECTION_KEY, SECTION_ORDER, visibleSections } from '@/lib/photo-edit/sections'
import { readUiMode } from '@/lib/ui-mode'

export default function PhotoEditor() {
  const source = usePhotoEditStore((s) => s.source)
  const pickerOpen = usePhotoEditStore((s) => s.pickerOpen)
  const loadSource = usePhotoEditStore((s) => s.loadSource)
  const searchParams = useSearchParams()

  // On mount / param change: if ?subfolder= and ?filename= are present and the
  // editor isn't already holding that image, load it into the canvas.
  useEffect(() => {
    const subfolder = searchParams.get('subfolder')
    const filename = searchParams.get('filename')
    if (!subfolder || !filename) return
    const req = { subfolder, filename }
    if (galleryOriginMatches(usePhotoEditStore.getState().origin, req)) return

    return startGalleryLoad(req, {
      fetchImage: async (url) => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`Gallery fetch failed: ${res.status}`)
        return res.blob()
      },
      createBitmap: (blob) => createImageBitmap(blob),
      loadSource,
      onError: (err) => {
        console.error('[PhotoEditor] Failed to load gallery image:', err)
        toast.error('Failed to load image')
      },
    })
  }, [searchParams, loadSource])

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  // Tooltips advertise the same keys, so the shortcuts teach themselves rather
  // than living in documentation nobody opens.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      // Never steal a key from a text field or the preset-name prompt.
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) {
        if (el.getAttribute('type') !== 'range') return
      }
      const s = usePhotoEditStore.getState()
      if (!s.source) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo(); else s.undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault(); s.redo(); return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const key = e.key.toLowerCase()
      // R / M / X open their section and arm its overlay — unless Simple hides it.
      const section = SECTION_ORDER.find((id) => SECTION_KEY[id]?.toLowerCase() === key)
      if (section === 'crop' || section === 'masks' || section === 'slice') {
        if (!visibleSections(readUiMode(), s.editState).includes(section)) return
        s.setCanvasMode(section)
        if (!s.openSections.includes(section)) s.toggleSection(section)
        e.preventDefault()
        return
      }
      switch (key) {
        case 'e': s.setCanvasMode('edit'); break
        case 'escape': s.setCanvasMode('edit'); break
        case '\\':
          // Hold, not toggle — matches the Compare button.
          if (!e.repeat) s.setComparing(true)
          break
        default: return
      }
      e.preventDefault()
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === '\\') usePhotoEditStore.getState().setComparing(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  if (!source || pickerOpen) {
    return <ImagePicker />
  }

  // TopBar across the top, the canvas, and one always-present edit column on the
  // right. Crop / Masks / Slice are its sections — opening one arms its overlay —
  // so there is no separate tool rail to disagree with them.
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar />

      <div className="flex min-h-0 flex-1">
        <EditorCanvas />

        <aside className="flex w-96 shrink-0 flex-col overflow-hidden border-l border-border bg-card/40">
          <EditPanel />
        </aside>
      </div>
    </div>
  )
}
