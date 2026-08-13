'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { galleryOriginMatches, startGalleryLoad } from '@/lib/photo-edit/deep-link'
import ImagePicker from './ImagePicker'
import EditorCanvas from './EditorCanvas'
import TopBar from './TopBar'
import ToolRail from './ToolRail'
import EditPanel from './EditPanel'

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

      const openFor = (section: 'crop' | 'masks' | 'slice') => {
        if (!s.openSections.includes(section)) s.toggleSection(section)
      }
      switch (e.key.toLowerCase()) {
        case 'e': s.setCanvasMode('edit'); break
        case 'r': s.setCanvasMode('crop'); openFor('crop'); break
        case 'm': s.setCanvasMode('masks'); openFor('masks'); break
        case 'x': s.setCanvasMode('slice'); openFor('slice'); break
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

  // TopBar across the top; a narrow mode rail on the left; the canvas in the
  // middle; and one always-present edit column on the right.
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-card/40 px-1 py-2">
          <ToolRail />
        </aside>

        <EditorCanvas />

        <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-border bg-card/40">
          <EditPanel />
        </aside>
      </div>
    </div>
  )
}
