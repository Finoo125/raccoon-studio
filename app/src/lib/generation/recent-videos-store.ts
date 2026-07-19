'use client'

import { create } from 'zustand'
import type { GalleryImage } from '@/types/gallery'
import { RECENT_LIMIT } from './recent-store'

interface RecentVideosState {
  videos: GalleryImage[]
  loadedOnce: boolean
  /**
   * Pull the latest videos from the on-disk gallery so the rail survives reloads
   * and shows results from every session. `force` rescans (used after a new
   * render lands a file on disk).
   */
  refresh(force?: boolean): Promise<void>
}

export const useRecentVideosStore = create<RecentVideosState>((set) => ({
  videos: [],
  loadedOnce: false,
  async refresh(force = false) {
    try {
      const res = await fetch(`/api/gallery?media=video&sort=newest${force ? '&refresh=true' : ''}`, {
        cache: 'no-store',
      })
      const data = (await res.json()) as { images: GalleryImage[] }
      set({ videos: data.images.slice(0, RECENT_LIMIT), loadedOnce: true })
    } catch {
      set({ loadedOnce: true })
    }
  },
}))
