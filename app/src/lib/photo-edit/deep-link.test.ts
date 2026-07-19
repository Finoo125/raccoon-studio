import { describe, it, expect, vi } from 'vitest'
import { galleryOriginMatches, startGalleryLoad } from './deep-link'

function fakeBitmap() {
  return { close: vi.fn() } as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('galleryOriginMatches', () => {
  const req = { subfolder: 'images/sdxl/2026-06-17', filename: 'a.png' }

  it('matches a gallery origin with the same subfolder + filename', () => {
    expect(galleryOriginMatches({ kind: 'gallery', ...req }, req)).toBe(true)
  })

  it('does not match a different filename', () => {
    expect(galleryOriginMatches({ kind: 'gallery', ...req }, { ...req, filename: 'b.png' })).toBe(false)
  })

  it('does not match an upload origin or null', () => {
    expect(galleryOriginMatches({ kind: 'upload', filename: 'a.png' }, req)).toBe(false)
    expect(galleryOriginMatches(null, req)).toBe(false)
  })
})

describe('startGalleryLoad', () => {
  const req = { subfolder: 'images/sdxl/d', filename: 'a.png' }

  it('fetches the image and calls loadSource with a gallery origin', async () => {
    const bmp = fakeBitmap()
    const loadSource = vi.fn()
    startGalleryLoad(req, {
      fetchImage: async () => new Blob(),
      createBitmap: async () => bmp,
      loadSource,
    })
    await flush()
    expect(loadSource).toHaveBeenCalledTimes(1)
    expect(loadSource).toHaveBeenCalledWith(bmp, { kind: 'gallery', ...req })
  })

  it('does not call loadSource (and closes the bitmap) when cancelled before it resolves', async () => {
    const bmp = fakeBitmap()
    const loadSource = vi.fn()
    const cancel = startGalleryLoad(req, {
      fetchImage: async () => new Blob(),
      createBitmap: async () => bmp,
      loadSource,
    })
    cancel()
    await flush()
    expect(loadSource).not.toHaveBeenCalled()
    expect((bmp as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalled()
  })

  // Regression for the React dev double-mount bug: mount 1 starts then is
  // cancelled by cleanup; mount 2 starts fresh and must still complete the load.
  it('completes on a second start even after the first was cancelled', async () => {
    const loadSource = vi.fn()
    const deps = {
      fetchImage: async () => new Blob(),
      createBitmap: async () => fakeBitmap(),
      loadSource,
    }
    const cancel1 = startGalleryLoad(req, deps)
    cancel1() // cleanup of mount 1
    startGalleryLoad(req, deps) // mount 2
    await flush()
    expect(loadSource).toHaveBeenCalledTimes(1)
    expect(loadSource).toHaveBeenCalledWith(expect.anything(), { kind: 'gallery', ...req })
  })

  it('reports errors via onError and never calls loadSource', async () => {
    const loadSource = vi.fn()
    const onError = vi.fn()
    startGalleryLoad(req, {
      fetchImage: async () => { throw new Error('fetch failed') },
      createBitmap: async () => fakeBitmap(),
      loadSource,
      onError,
    })
    await flush()
    expect(loadSource).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
