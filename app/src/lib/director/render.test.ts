import { describe, it, expect } from 'vitest'
import { buildBeatVideoParams, parseComfyViewUrl } from './render'
import { createRunDoc, applyStoryboard } from './run-doc'

function run() {
  return applyStoryboard(
    createRunDoc({ name: 'f', plot: 'p', imageModel: 'anima', ollamaModel: 'm', targetSeconds: 30 }),
    { openingImagePrompt: 'x', beats: ['a moody alley', 'the alley at dawn'] },
  )
}

describe('buildBeatVideoParams', () => {
  it('builds an i2v request seeded by the given image, 15s, using the beat prompt', () => {
    const p = buildBeatVideoParams(run(), 1, 'lf0.png')
    expect(p.mode).toBe('i2v')
    expect(p.inputImage).toBe('lf0.png')
    expect(p.prompt).toBe('the alley at dawn')
    expect(p.durationSeconds).toBe(15)
    expect(p.fps).toBe(30)
    expect(p.seed).toBe(-1)
  })

  it('passes the seed image dimensions through when provided', () => {
    const p = buildBeatVideoParams(run(), 0, 'lf0.png', { w: 1920, h: 1088 })
    expect(p.inputImageWidth).toBe(1920)
    expect(p.inputImageHeight).toBe(1088)
  })
})

describe('parseComfyViewUrl', () => {
  it('extracts filename/subfolder/type from a view URL', () => {
    const u = '/api/comfyui/view?filename=LTX23_00001.mp4&subfolder=video%2FLTX23%2F2026-06-14&type=output'
    expect(parseComfyViewUrl(u)).toEqual({
      filename: 'LTX23_00001.mp4',
      subfolder: 'video/LTX23/2026-06-14',
      type: 'output',
    })
  })

  it('defaults a missing subfolder to empty string', () => {
    expect(parseComfyViewUrl('/api/comfyui/view?filename=x.mp4&type=output')).toEqual({
      filename: 'x.mp4', subfolder: '', type: 'output',
    })
  })

  it('returns null when there is no filename', () => {
    expect(parseComfyViewUrl('/api/comfyui/view?type=output')).toBeNull()
    expect(parseComfyViewUrl('not a url at all')).toBeNull()
  })
})
