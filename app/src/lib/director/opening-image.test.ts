import { describe, it, expect } from 'vitest'
import { buildOpeningImageParams } from './opening-image'
import { createRunDoc, applyStoryboard } from './run-doc'

function storyboardedRun(imageModel: 'anima' | 'z-image-turbo') {
  const run = createRunDoc({
    name: 'f', plot: 'p', imageModel, ollamaModel: 'm', targetSeconds: 60,
  })
  return applyStoryboard(run, {
    openingImagePrompt: 'a wide cinematic city at dawn',
    negativePrompt: 'blurry, low quality',
    beats: ['b1', 'b2', 'b3', 'b4'],
  })
}

describe('buildOpeningImageParams', () => {
  it('passes the opening-image prompt + negative and a random seed', () => {
    const p = buildOpeningImageParams(storyboardedRun('anima'))
    expect(p.prompt).toBe('a wide cinematic city at dawn')
    expect(p.negativePrompt).toBe('blurry, low quality')
    expect(p.seed).toBe(-1)
    expect(p.batchSize).toBe(1)
  })

  it('uses a 16:9 cinematic frame and skips upscale + detailer (fast, dependency-free seed)', () => {
    const p = buildOpeningImageParams(storyboardedRun('anima'))
    expect(p.width).toBe(1344)
    expect(p.height).toBe(768)
    expect(p.upscale).toBe(false)
    expect(p.detailer).toBe(false)
  })

  it('derives the same 16:9 size for the z-image-turbo workflow', () => {
    const p = buildOpeningImageParams(storyboardedRun('z-image-turbo'))
    expect(p.width).toBe(1344)
    expect(p.height).toBe(768)
  })
})
