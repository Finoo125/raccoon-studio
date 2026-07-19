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
import AdjustPanel from './AdjustPanel'
import FilterStrip from './FilterStrip'
import CropOverlay from './CropOverlay'
import SlicePanel from './SlicePanel'

export default function PhotoEditor() {
  const source = usePhotoEditStore((s) => s.source)
  const pickerOpen = usePhotoEditStore((s) => s.pickerOpen)
  const activeTool = usePhotoEditStore((s) => s.activeTool)
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

  if (!source || pickerOpen) {
    return <ImagePicker />
  }

  // Layout B: TopBar (top) / ToolRail (left icon col) / EditorCanvas (center)
  //           / right panel (adjust/crop/geometry) / bottom FilterStrip (filters tool).
  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── TopBar ── */}
      <TopBar />

      {/* ── Main row: ToolRail + EditorCanvas + right panel ── */}
      <div className="flex min-h-0 flex-1">

        {/* ── ToolRail ── */}
        <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-card/40 py-2">
          <ToolRail />
        </aside>

        {/* ── Center: canvas + optional bottom FilterStrip ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <EditorCanvas />

          {activeTool === 'filters' && (
            <div className="shrink-0 border-t border-border bg-card/40">
              <FilterStrip />
            </div>
          )}
        </div>

        {/* ── Right panel: AdjustPanel | CropOverlay (also for geometry) ── */}
        {(activeTool === 'adjust') && (
          <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-l border-border bg-card/40">
            <AdjustPanel />
          </aside>
        )}

        {(activeTool === 'crop' || activeTool === 'geometry') && (
          <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-l border-border bg-card/40">
            <CropOverlay />
          </aside>
        )}

        {activeTool === 'slice' && (
          <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-l border-border bg-card/40">
            <SlicePanel />
          </aside>
        )}
      </div>
    </div>
  )
}
