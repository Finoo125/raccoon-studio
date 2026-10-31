import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// scanner.ts reads COMFYUI_OUTPUT_DIR when it loads, so each test imports it fresh.
let tmp: string
const dateDir = () => path.join(tmp, 'out', 'images', 'ZIT', '2026-06-12')
const scanner = async () => {
  vi.resetModules()
  return import('./scanner')
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-fresh-'))
  fs.mkdirSync(dateDir(), { recursive: true })
  process.env.COMFYUI_OUTPUT_DIR = path.join(tmp, 'out')
  process.env.RACCOON_GALLERY_CACHE = path.join(tmp, 'cache.json')
  process.env.RACCOON_SIDECAR_DIR = path.join(tmp, 'sidecars')
})
afterEach(() => {
  vi.useRealTimers()
  fs.rmSync(tmp, { recursive: true, force: true })
  delete process.env.COMFYUI_OUTPUT_DIR
  delete process.env.RACCOON_GALLERY_CACHE
  delete process.env.RACCOON_SIDECAR_DIR
})

describe('getGalleryRaw freshness', () => {
  it('reuses a settled scan, and rescans as soon as a file lands', async () => {
    const { getGalleryRaw } = await scanner()
    fs.writeFileSync(path.join(dateDir(), 'a.png'), 'x')
    vi.useFakeTimers({ now: Date.now() + 120_000, toFake: ['Date'] }) // past the settle window
    expect(getGalleryRaw().images).toHaveLength(1)
    expect(getGalleryRaw().cached).toBe(true)

    await new Promise((r) => setTimeout(r, 50)) // a later folder mtime than the scan saw
    fs.writeFileSync(path.join(dateDir(), 'b.png'), 'x')
    const next = getGalleryRaw()
    expect(next.cached).toBe(false)
    expect(next.images.map((i) => i.filename).sort()).toEqual(['a.png', 'b.png'])
  })

  it('keeps rescanning right after a change, so a file still being written is read again', async () => {
    const { getGalleryRaw } = await scanner()
    fs.writeFileSync(path.join(dateDir(), 'a.png'), 'x')
    expect(getGalleryRaw().cached).toBe(false)
    expect(getGalleryRaw().cached).toBe(false)
  })

  it('points every tile at a thumbnail that changes with the file', async () => {
    const { getGalleryRaw, imageId } = await scanner()
    fs.writeFileSync(path.join(dateDir(), 'a.png'), 'x')
    const [img] = getGalleryRaw().images
    expect(img.thumbnailUrl).toBe(`/api/gallery/thumb?id=${imageId('images/ZIT/2026-06-12', 'a.png')}&v=${Math.round(img.mtimeMs!)}`)
  })
})
