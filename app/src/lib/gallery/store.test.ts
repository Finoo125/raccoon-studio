import { describe, it, expect, beforeEach } from 'vitest'
import { useGalleryStore } from './store'
import type { GalleryImage } from '@/types/gallery'

const img = (id: string): GalleryImage => ({
  id, filename: id + '.png', subfolder: 's', url: '', thumbnailUrl: '',
  createdAt: '', metadata: {}, favorite: false, tags: [],
})

beforeEach(() => {
  useGalleryStore.setState({ selecting: false, selectedIds: [], images: [img('a'), img('b'), img('c')], selected: null })
})

describe('gallery multi-select', () => {
  it('toggleSelect adds then removes an id', () => {
    useGalleryStore.getState().toggleSelect('a')
    expect(useGalleryStore.getState().selectedIds).toEqual(['a'])
    useGalleryStore.getState().toggleSelect('a')
    expect(useGalleryStore.getState().selectedIds).toEqual([])
  })
  it('setSelecting(false) clears the selection', () => {
    useGalleryStore.getState().toggleSelect('a')
    useGalleryStore.getState().setSelecting(false)
    expect(useGalleryStore.getState().selectedIds).toEqual([])
    expect(useGalleryStore.getState().selecting).toBe(false)
  })
  it('removeImages drops items and deselects them', () => {
    useGalleryStore.getState().selectAll(['a', 'b'])
    useGalleryStore.getState().removeImages(['a'])
    expect(useGalleryStore.getState().images.map((i) => i.id)).toEqual(['b', 'c'])
    expect(useGalleryStore.getState().selectedIds).toEqual(['b'])
  })
})

describe('gallery media mode', () => {
  it('drops the workflow filter when the mode changes', () => {
    // Images filter by preset ("Anima"), videos by model ("MinimaxH3"), and the
    // scanner matches the value by exact equality — so a filter carried across
    // the switch matches nothing and shows an empty gallery with no visible
    // cause.
    useGalleryStore.getState().setMediaMode('image')
    useGalleryStore.getState().setFilter('workflow', 'Anima')
    useGalleryStore.getState().setMediaMode('video')
    expect(useGalleryStore.getState().filters.workflow).toBe('')
    expect(useGalleryStore.getState().mediaMode).toBe('video')
  })

  it('leaves the filter alone when the mode is unchanged', () => {
    useGalleryStore.getState().setMediaMode('video')
    useGalleryStore.getState().setFilter('workflow', 'MinimaxH3')
    useGalleryStore.getState().setMediaMode('video')
    expect(useGalleryStore.getState().filters.workflow).toBe('MinimaxH3')
  })
})
