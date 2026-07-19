'use client'

import { create } from 'zustand'
import type { GalleryImage } from '@/types/gallery'

/** How many of the most recent gallery images the generate rail shows. */
export const RECENT_LIMIT = 25

interface RecentImagesState {
  images: GalleryImage[]
  loadedOnce: boolean
  /**
   * Pull the latest images from the on-disk gallery so the rail survives reloads
   * and shows results from every session. `force` rescans (used after a new
   * generation lands a file on disk).
   */
  refresh(force?: boolean): Promise<void>
}

export const useRecentImagesStore = create<RecentImagesState>((set) => ({
  images: [],
  loadedOnce: false,
  async refresh(force = false) {
    try {
      const res = await fetch(`/api/gallery?sort=newest${force ? '&refresh=true' : ''}`, {
        cache: 'no-store',
      })
      const data = (await res.json()) as { images: GalleryImage[] }
      set({ images: data.images.slice(0, RECENT_LIMIT), loadedOnce: true })
    } catch {
      set({ loadedOnce: true })
    }
  },
}))
