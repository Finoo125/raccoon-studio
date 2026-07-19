import { describe, it, expect } from 'vitest'
import { dateKeyOf, buildFolders } from './folders'
import type { GalleryImage } from '@/types/gallery'

function img(partial: Partial<GalleryImage> & { id: string }): GalleryImage {
  return {
    filename: `${partial.id}.png`,
    subfolder: 'images/ZIT/2026-06-12',
    url: '/u',
    thumbnailUrl: '/t',
    createdAt: '2026-06-12T10:00:00.000Z',
    metadata: {},
    favorite: false,
    ...partial,
  }
}

describe('dateKeyOf', () => {
  it('uses the date-folder segment of the subfolder', () => {
    expect(dateKeyOf(img({ id: 'a', subfolder: 'images/ZIT/2026-06-12' }))).toBe('2026-06-12')
  })

  it('falls back to the createdAt day when no date segment exists', () => {
    expect(
      dateKeyOf(img({ id: 'b', subfolder: 'images/ZIT', createdAt: '2026-05-01T09:00:00.000Z' })),
    ).toBe('2026-05-01')
  })

  it('keeps a non-date folder name as-is (e.g. the literal %date% bug folder)', () => {
    const key = dateKeyOf(img({ id: 'c', subfolder: 'images/ZIT/%date:yyyy-MM-dd%' }))
    expect(key).toBe('%date:yyyy-MM-dd%')
  })
})

describe('buildFolders', () => {
  it('groups images by date and counts them', () => {
    const folders = buildFolders([
      img({ id: 'a', subfolder: 'images/ZIT/2026-06-12' }),
      img({ id: 'b', subfolder: 'images/ERNIE/2026-06-12' }),
      img({ id: 'c', subfolder: 'images/ZIT/2026-06-11' }),
    ])
    expect(folders).toHaveLength(2)
    expect(folders.find((f) => f.key === '2026-06-12')?.count).toBe(2)
    expect(folders.find((f) => f.key === '2026-06-11')?.count).toBe(1)
  })

  it('sorts folders newest-first', () => {
    const folders = buildFolders([
      img({ id: 'a', subfolder: 'images/ZIT/2026-06-10' }),
      img({ id: 'b', subfolder: 'images/ZIT/2026-06-12' }),
      img({ id: 'c', subfolder: 'images/ZIT/2026-06-11' }),
    ])
    expect(folders.map((f) => f.key)).toEqual(['2026-06-12', '2026-06-11', '2026-06-10'])
  })

  it('uses the newest image in a date as the cover thumbnail', () => {
    const folders = buildFolders([
      img({ id: 'old', subfolder: 'images/ZIT/2026-06-12', createdAt: '2026-06-12T08:00:00.000Z', thumbnailUrl: '/old' }),
      img({ id: 'new', subfolder: 'images/ZIT/2026-06-12', createdAt: '2026-06-12T20:00:00.000Z', thumbnailUrl: '/new' }),
    ])
    expect(folders[0].coverUrl).toBe('/new')
  })

  it('formats a parseable key as a friendly label, else keeps it raw', () => {
    const folders = buildFolders([
      img({ id: 'a', subfolder: 'images/ZIT/2026-06-12' }),
      img({ id: 'b', subfolder: 'images/ZIT/%date:yyyy-MM-dd%' }),
    ])
    expect(folders.find((f) => f.key === '2026-06-12')?.label).toMatch(/2026/)
    expect(folders.find((f) => f.key === '2026-06-12')?.label).not.toBe('2026-06-12')
    expect(folders.find((f) => f.key === '%date:yyyy-MM-dd%')?.label).toBe('%date:yyyy-MM-dd%')
  })

  it('returns an empty array for no images', () => {
    expect(buildFolders([])).toEqual([])
  })

  it('groups video items by their date segment and flags the cover as video', () => {
    const folders = buildFolders([
      img({ id: 'v', media: 'video', subfolder: 'video/LTX23/2026-06-13', thumbnailUrl: '/api/gallery/video?x' }),
    ])
    expect(folders).toHaveLength(1)
    expect(folders[0].key).toBe('2026-06-13')
    expect(folders[0].coverIsVideo).toBe(true)
    expect(folders[0].coverUrl).toBe('/api/gallery/video?x')
  })

  it('flags image covers as not video', () => {
    const folders = buildFolders([img({ id: 'a', subfolder: 'images/ZIT/2026-06-12' })])
    expect(folders[0].coverIsVideo).toBe(false)
  })
})
