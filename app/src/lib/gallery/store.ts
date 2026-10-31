'use client'

import { create } from 'zustand'
import type { GalleryImage, GalleryFilters } from '@/types/gallery'
import { dateKeyOf } from './folders'

/** What the grid shows: the browsed date folder, or everything. Bulk actions act on exactly this. */
export function visibleImages(images: GalleryImage[], folder: string | null): GalleryImage[] {
  return folder ? images.filter((img) => dateKeyOf(img) === folder) : images
}

// A selection never outlives what is on screen: a search or a folder change used to
// leave hidden items selected, and Delete removed them along with the visible ones.
const keepVisible = (ids: string[], images: GalleryImage[], folder: string | null) => {
  if (ids.length === 0) return ids
  const shown = new Set(visibleImages(images, folder).map((i) => i.id))
  return ids.filter((id) => shown.has(id))
}

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

  setImages: (images) => set((s) => ({ images, selectedIds: keepVisible(s.selectedIds, images, s.selectedFolder) })),
  setLoading: (loading) => set({ loading }),
  setSelected: (selected) => set({ selected }),
  setScanMeta: (imagesDir, scannedAt) => set({ imagesDir, scannedAt }),
  setSelectedFolder: (selectedFolder) =>
    set((s) => ({ selectedFolder, selectedIds: keepVisible(s.selectedIds, s.images, selectedFolder) })),
  // Switching media resets the browsed folder + open inspector, since the folder
  // tree and item list differ between images and videos.
  // The workflow filter is reset with the mode because its options differ per
  // mode: images offer presets, videos offer models, and the scanner matches
  // the value by exact equality. Carrying "Anima" into video mode would match
  // nothing and show an empty gallery with no obvious cause.
  setMediaMode: (mediaMode) =>
    set((s) =>
      s.mediaMode === mediaMode
        ? s
        : {
            mediaMode,
            selectedFolder: null,
            selected: null,
            selectedIds: [],
            selecting: false,
            filters: { ...s.filters, workflow: '' },
          },
    ),
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
