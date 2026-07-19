'use client'

import { create } from 'zustand'
import type { GalleryImage, GalleryFilters } from '@/types/gallery'

interface GalleryState {
  images: GalleryImage[]
  loading: boolean
  selected: GalleryImage | null
  filters: GalleryFilters
  imagesDir: string | null
  scannedAt: string | null
  /** Date-folder key currently browsed; null = "All images". */
  selectedFolder: string | null
  /** Whether the folder sidebar is collapsed. */
  sidebarCollapsed: boolean
  /** Browsing images or videos. Switches the scanned source + folder tree. */
  mediaMode: 'image' | 'video'
  /** Multi-select mode: clicking a tile toggles selection instead of opening the inspector. */
  selecting: boolean
  selectedIds: string[]
  setSelecting(v: boolean): void
  toggleSelect(id: string): void
  selectAll(ids: string[]): void
  clearSelection(): void
  removeImages(ids: string[]): void
  setImages(images: GalleryImage[]): void
  setLoading(v: boolean): void
  setSelected(img: GalleryImage | null): void
  setFilter<K extends keyof GalleryFilters>(key: K, value: GalleryFilters[K]): void
  setScanMeta(imagesDir: string | null, scannedAt: string | null): void
  setSelectedFolder(key: string | null): void
  setMediaMode(mode: 'image' | 'video'): void
  toggleSidebar(): void
  toggleFavorite(id: string): void
}

const defaultFilters: GalleryFilters = {
  search: '',
  workflow: '',
  dateFrom: '',
  dateTo: '',
  favoritesOnly: false,
  sortBy: 'newest',
  tag: '',
  model: '',
  sampler: '',
  dimensions: '',
}

export const useGalleryStore = create<GalleryState>((set) => ({
  images: [],
  loading: false,
  selected: null,
  filters: defaultFilters,
  imagesDir: null,
  scannedAt: null,
  selectedFolder: null,
  sidebarCollapsed: false,
  mediaMode: 'image',
  selecting: false,
  selectedIds: [],

  setSelecting: (selecting) => set(selecting ? { selecting } : { selecting, selectedIds: [] }),
  toggleSelect: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),
  selectAll: (ids) => set({ selectedIds: ids }),
  clearSelection: () => set({ selectedIds: [] }),
  removeImages: (ids) =>
    set((s) => {
      const drop = new Set(ids)
      return {
        images: s.images.filter((i) => !drop.has(i.id)),
        selectedIds: s.selectedIds.filter((x) => !drop.has(x)),
        selected: s.selected && drop.has(s.selected.id) ? null : s.selected,
      }
    }),

  setImages: (images) => set({ images }),
  setLoading: (loading) => set({ loading }),
  setSelected: (selected) => set({ selected }),
  setScanMeta: (imagesDir, scannedAt) => set({ imagesDir, scannedAt }),
  setSelectedFolder: (selectedFolder) => set({ selectedFolder }),
  // Switching media resets the browsed folder + open inspector, since the folder
  // tree and item list differ between images and videos.
  setMediaMode: (mediaMode) =>
    set((s) => (s.mediaMode === mediaMode ? s : { mediaMode, selectedFolder: null, selected: null, selectedIds: [], selecting: false })),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  setFilter: (key, value) =>
    set((s) => ({ filters: { ...s.filters, [key]: value } })),

  toggleFavorite: (id) =>
    set((s) => ({
      images: s.images.map((img) =>
        img.id === id ? { ...img, favorite: !img.favorite } : img
      ),
      selected:
        s.selected?.id === id
          ? { ...s.selected, favorite: !s.selected.favorite }
          : s.selected,
    })),
}))
