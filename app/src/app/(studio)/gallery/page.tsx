'use client'

import { Suspense, useEffect, useCallback, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useGalleryStore } from '@/lib/gallery/store'
import type { GalleryImage } from '@/types/gallery'
import GalleryGrid from '@/components/gallery/GalleryGrid'
import GalleryInspector from '@/components/gallery/GalleryInspector'
import GalleryToolbar from '@/components/gallery/GalleryToolbar'
import GalleryFolderSidebar from '@/components/gallery/GalleryFolderSidebar'
import GalleryBulkBar from '@/components/gallery/GalleryBulkBar'
import CompareOverlay from '@/components/gallery/CompareOverlay'

interface GalleryResponse {
  images: GalleryImage[]
  total: number
  scannedAt: string
  imagesDir: string
  cached: boolean
}

// Automatic background rescan cadence (matches the server-side cache TTL).
const AUTO_SCAN_MS = 10 * 60 * 1000

export default function GalleryPage() {
  return (
    <Suspense fallback={null}>
      <GalleryPageInner />
    </Suspense>
  )
}

function GalleryPageInner() {
  const searchParams = useSearchParams()
  const { filters, mediaMode, setImages, setLoading, loading, selected, setScanMeta } = useGalleryStore()
  const [compareOpen, setCompareOpen] = useState(false)

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('media', mediaMode)
      if (filters.search) params.set('search', filters.search)
      if (filters.workflow) params.set('workflow', filters.workflow)
      if (filters.favoritesOnly) params.set('favorites', 'true')
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
      if (filters.dateTo) params.set('dateTo', filters.dateTo)
      if (filters.tag) params.set('tag', filters.tag)
      if (filters.model) params.set('model', filters.model)
      if (filters.sampler) params.set('sampler', filters.sampler)
      if (filters.dimensions) params.set('dimensions', filters.dimensions)
      params.set('sort', filters.sortBy)
      if (refresh) params.set('refresh', 'true')
      const res = await fetch(`/api/gallery?${params}`, { cache: 'no-store' })
      const data = (await res.json()) as GalleryResponse
      setImages(data.images)
      setScanMeta(data.imagesDir, data.scannedAt)
    } finally {
      setLoading(false)
    }
  }, [filters, mediaMode, setImages, setLoading, setScanMeta])

  useEffect(() => { void load() }, [load])

  // Auto-scan for new images every 10 minutes (only while the tab is visible).
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, AUTO_SCAN_MS)
    return () => clearInterval(id)
  }, [load])

  // Handle ?workflow= from "send to generate" reverse flow (unused here but symmetric)
  useEffect(() => {
    const wf = searchParams.get('workflow')
    if (wf) useGalleryStore.getState().setFilter('workflow', wf)
  }, [searchParams])

  return (
    <div className="flex h-full overflow-hidden">
      {/* Folder sidebar */}
      <GalleryFolderSidebar />

      {/* Main grid area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <GalleryToolbar onRefresh={() => load(true)} loading={loading} />
        <GalleryBulkBar onCompare={() => setCompareOpen(true)} />
        <div className="flex-1 min-h-0">
          <GalleryGrid />
        </div>
      </div>

      {/* Inspector panel */}
      {selected && (
        <aside className="w-[min(55vw,53.75rem)] min-w-[37.5rem] shrink-0 border-l border-border bg-card/40 overflow-hidden">
          <GalleryInspector />
        </aside>
      )}

      <CompareOverlay open={compareOpen} onOpenChange={setCompareOpen} />
    </div>
  )
}
