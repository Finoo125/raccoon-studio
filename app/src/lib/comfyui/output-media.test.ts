import { describe, it, expect } from 'vitest'
import { resolveOutputMedia } from './output-media'

describe('resolveOutputMedia', () => {
  it('builds view URLs from image outputs and reports them as images', () => {
    const res = resolveOutputMedia({
      images: [{ filename: 'a.png', subfolder: 'sub', type: 'output' }],
    })
    expect(res.isVideo).toBe(false)
    expect(res.urls).toEqual([
      '/api/comfyui/view?filename=a.png&subfolder=sub&type=output',
    ])
  })

  it('builds view URLs from VHS gifs outputs and reports them as video', () => {
    const res = resolveOutputMedia({
      gifs: [{ filename: 'clip.mp4', subfolder: 'video/LTX23', type: 'output' }],
    })
    expect(res.isVideo).toBe(true)
    expect(res.urls).toEqual([
      '/api/comfyui/view?filename=clip.mp4&subfolder=video%2FLTX23&type=output',
    ])
  })

  it('prefers gifs over images when both are present', () => {
    const res = resolveOutputMedia({
      images: [{ filename: 'a.png', subfolder: '', type: 'output' }],
      gifs: [{ filename: 'clip.mp4', subfolder: '', type: 'output' }],
    })
    expect(res.isVideo).toBe(true)
    expect(res.urls).toEqual(['/api/comfyui/view?filename=clip.mp4&subfolder=&type=output'])
  })

  it('returns no urls for an empty/absent output', () => {
    expect(resolveOutputMedia(undefined)).toEqual({ urls: [], isVideo: false })
    expect(resolveOutputMedia({})).toEqual({ urls: [], isVideo: false })
  })

  it('ignores temp previews and keeps only saved output media', () => {
    // LTX low-res first pass (temp) must not be mistaken for the final mp4.
    const res = resolveOutputMedia({
      gifs: [
        { filename: 'preview.mp4', subfolder: '', type: 'temp' },
        { filename: 'final.mp4', subfolder: '', type: 'output' },
      ],
    })
    expect(res).toEqual({
      urls: ['/api/comfyui/view?filename=final.mp4&subfolder=&type=output'],
      isVideo: true,
    })
  })

  it('treats a temp-only output as empty (nothing saved yet)', () => {
    expect(
      resolveOutputMedia({ images: [{ filename: 'p.png', subfolder: '', type: 'temp' }] }),
    ).toEqual({ urls: [], isVideo: false })
  })
})
