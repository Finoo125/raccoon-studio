import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { comfyInputUrl, peaksPath, shotVisionB64 } from './lane-media'
import { downscaleFileToB64 } from '@/lib/generation/image-b64'
import type { DirectorShot } from '@/lib/workflows/director-timeline'

// Both are browser-only (canvas / createImageBitmap), and these tests run in
// node. Mocking the downscale leaves the branching in shotVisionB64 itself —
// which is the part with something to get wrong — under test.
vi.mock('@/lib/generation/image-b64', () => ({ downscaleFileToB64: vi.fn() }))

describe('comfyInputUrl', () => {
  it('points a bare filename at the input dir through the proxy', () => {
    const url = comfyInputUrl('shot.png')
    expect(url).toContain('/api/comfyui/view?')
    expect(url).toContain('filename=shot.png')
    expect(url).toContain('type=input')
    expect(url).toContain('subfolder=')
  })

  it('splits a subfolder off the filename — ComfyUI takes them separately', () => {
    const url = comfyInputUrl('clips/take 2.mp4')
    expect(url).toContain('filename=take%202.mp4')
    expect(url).toContain('subfolder=clips')
  })

  it('uses only the last slash, so nested folders survive', () => {
    expect(comfyInputUrl('a/b/c.png')).toContain('subfolder=a%2Fb')
  })

  it('escapes characters that would otherwise break the query', () => {
    const url = comfyInputUrl('a&b=c.png')
    expect(url).toContain('filename=a%26b%3Dc.png')
  })
})

describe('peaksPath', () => {
  it('returns an empty path for no peaks rather than broken markup', () => {
    expect(peaksPath([])).toBe('')
  })

  it('produces a closed path across the full 0..100 viewBox', () => {
    const d = peaksPath([0, 1, 0, 1])
    expect(d.startsWith('M')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    expect(d).toContain('75.00') // the last of four columns
  })

  it('mirrors each peak about the centre line', () => {
    // A single full-scale peak reaches 48 above and below the 50 centre.
    const d = peaksPath([1])
    expect(d).toContain('2.00') // 50 - 48
    expect(d).toContain('98.00') // 50 + 48
  })

  it('draws silence as a flat line on the centre', () => {
    const d = peaksPath([0, 0])
    // Every y coordinate is the centre line; nothing deviates from it.
    const ys = [...d.matchAll(/,(\d+\.\d+)/g)].map((m) => m[1])
    expect(ys.length).toBeGreaterThan(0)
    expect(new Set(ys)).toEqual(new Set(['50.00']))
  })

  it('pairs each column with its own peak, not a mirrored one', () => {
    // Loud at the start, silent at the end: the x=0 column must be the tall one
    // on both the top and the bottom edge of the path.
    const d = peaksPath([1, 0])
    expect(d).toContain('0.00,2.00')
    expect(d).toContain('0.00,98.00')
    expect(d).toContain('50.00,50.00')
  })
})

describe('shotVisionB64', () => {
  const shot = (over: Partial<DirectorShot> = {}): DirectorShot =>
    ({ id: 's1', startSec: 0, lengthSec: 1, prompt: '', ...over })
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.mocked(downscaleFileToB64).mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('has nothing to show for a text-only block', async () => {
    await expect(shotVisionB64(shot())).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches a still out of the input dir and hands back the downscaled base64', async () => {
    fetchMock.mockResolvedValue({ blob: async () => new Blob(['x']) })
    vi.mocked(downscaleFileToB64).mockResolvedValue('QUJD')
    await expect(shotVisionB64(shot({ file: 'shot.png' }))).resolves.toBe('QUJD')
    expect(String(fetchMock.mock.calls[0][0])).toContain('filename=shot.png')
  })

  // The contract that matters: one unreadable picture costs the enhancer that
  // picture, never the whole enhance. Every failure mode resolves null instead
  // of rejecting, because the caller Promise.all's these.
  it('resolves null when the file cannot be fetched', async () => {
    fetchMock.mockRejectedValue(new Error('404'))
    await expect(shotVisionB64(shot({ file: 'gone.png' }))).resolves.toBeNull()
  })

  it('resolves null when the downscale throws', async () => {
    fetchMock.mockResolvedValue({ blob: async () => new Blob(['x']) })
    vi.mocked(downscaleFileToB64).mockRejectedValue(new Error('decode failed'))
    await expect(shotVisionB64(shot({ file: 'broken.png' }))).resolves.toBeNull()
  })

  it('turns an empty downscale into null rather than an empty image', async () => {
    fetchMock.mockResolvedValue({ blob: async () => new Blob(['x']) })
    vi.mocked(downscaleFileToB64).mockResolvedValue('')
    await expect(shotVisionB64(shot({ file: 'blank.png' }))).resolves.toBeNull()
  })

  // ponytail: the `kind: 'video'` branch lifts a frame via poster(), which needs
  // a <video> element and a canvas — no DOM here, and jsdom is deliberately not
  // a devDependency (the installers run a plain `npm install`). Covered by the
  // browser pass instead.
})
