import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { applyFilters, writeTags, readAllSidecars, writeFavorite, decodeImageId, imageId } from './scanner'
import type { GalleryImage } from '@/types/gallery'

function item(partial: Partial<GalleryImage> & { id: string }): GalleryImage {
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

describe('applyFilters media option', () => {
  const list = [
    item({ id: 'i1', media: 'image' }),
    item({ id: 'i2' }), // absent media counts as image
    item({ id: 'v1', media: 'video', subfolder: 'video/LTX23/2026-06-12' }),
  ]

  it('returns only images (incl. legacy items without a media field) for media:image', () => {
    const out = applyFilters(list, { media: 'image' })
    expect(out.map((i) => i.id).sort()).toEqual(['i1', 'i2'])
  })

  it('returns only videos for media:video', () => {
    const out = applyFilters(list, { media: 'video' })
    expect(out.map((i) => i.id)).toEqual(['v1'])
  })

  it('returns everything when no media option is given', () => {
    const out = applyFilters(list, {})
    expect(out).toHaveLength(3)
  })
})

describe('applyFilters — tag + metadata', () => {
  it('filters by tag membership', () => {
    const list = [item({ id: 'a', tags: ['portrait'] }), item({ id: 'b', tags: ['landscape'] })]
    expect(applyFilters(list, { tag: 'portrait' })).toHaveLength(1)
  })
  it('filters by model and sampler exact match', () => {
    const list = [
      item({ id: 'a', metadata: { model: 'sdxl', sampler: 'euler' } }),
      item({ id: 'b', metadata: { model: 'pony', sampler: 'dpmpp' } }),
    ]
    expect(applyFilters(list, { model: 'sdxl' })).toHaveLength(1)
    expect(applyFilters(list, { sampler: 'dpmpp' })).toHaveLength(1)
  })
  it('filters by dimensions "WxH"', () => {
    const list = [
      item({ id: 'a', metadata: { width: 1024, height: 1024 } }),
      item({ id: 'b', metadata: { width: 832, height: 1216 } }),
    ]
    expect(applyFilters(list, { dimensions: '832x1216' })).toHaveLength(1)
  })
})

describe('sidecar tags + id codec', () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-side-'))
    process.env.RACCOON_SIDECAR_DIR = tmp
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
    delete process.env.RACCOON_SIDECAR_DIR
  })

  it('writeTags + readAllSidecars round-trips and preserves favorite', () => {
    const id = imageId('images/ZIT/2026-06-20', 'a.png')
    writeFavorite(id, true)
    writeTags(id, ['portrait', 'wip'])
    expect(readAllSidecars().get(id)).toEqual({ favorite: true, tags: ['portrait', 'wip'] })
  })

  it('decodeImageId is the inverse of imageId, splitting filename off the end', () => {
    const id = imageId('images/ZIT/2026-06-20', 'a.png')
    expect(decodeImageId(id)).toEqual({ subfolder: 'images/ZIT/2026-06-20', filename: 'a.png' })
  })

  it('decodeImageId returns null for garbage input', () => {
    expect(decodeImageId('!!!not-base64!!!@@@')).toBeNull()
  })
})
