'use client'

import { create } from 'zustand'

interface AddonState {
  unlocked: string[]
  loaded: boolean
  load: () => Promise<void>
  setUnlocked: (ids: string[]) => void
}

export const useAddonStore = create<AddonState>((set) => ({
  unlocked: [],
  loaded: false,
  setUnlocked: (ids) => set({ unlocked: ids }),
  load: async () => {
    try {
      const res = await fetch('/api/addons', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { unlocked: string[] }
      set({ unlocked: data.unlocked ?? [], loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
}))
