import { describe, it, expect } from 'vitest'
import { canvasMediaKey } from './canvas-preview'

describe('canvasMediaKey', () => {
  it('returns a constant key while a live preview is showing, regardless of the blob URL', () => {
    // Each sampling frame is a fresh object URL, but the key must stay stable so
    // the canvas updates the <img src> in place instead of remounting (which
    // replays the entrance animation every frame and hides the noise).
    const frame1 = 'blob:http://localhost/aaa'
    const frame2 = 'blob:http://localhost/bbb'
    expect(canvasMediaKey(frame1, frame1)).toBe('live-preview')
    expect(canvasMediaKey(frame2, frame2)).toBe('live-preview')
    expect(canvasMediaKey(frame1, frame1)).toBe(canvasMediaKey(frame2, frame2))
  })

  it('keys on the URL for a settled image (no live preview) so its entrance plays once', () => {
    const result = '/api/comfyui/view?filename=out.png'
    expect(canvasMediaKey(result, undefined)).toBe(result)
  })

  it('returns placeholder when there is nothing to show', () => {
    expect(canvasMediaKey(undefined, undefined)).toBe('placeholder')
  })

  it('keys on the result URL once the live preview has cleared', () => {
    // displayUrl is the final image and livePreview is gone → not a live frame.
    const result = '/api/comfyui/view?filename=final.png'
    expect(canvasMediaKey(result, undefined)).toBe(result)
  })
})
