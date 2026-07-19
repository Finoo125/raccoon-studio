import { describe, it, expect } from 'vitest'
import { appendFilmGrain } from './film-grain'
import type { ComfyUIPrompt } from '@/types/comfyui'

function makeWf(): ComfyUIPrompt {
  return {
    '99': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'test', images: ['det:face', 0] },
    },
  }
}

describe('appendFilmGrain', () => {
  it('adds a grain:film Film Grain node', () => {
    const wf = makeWf()
    appendFilmGrain(wf, '99')
    expect(wf['grain:film'].class_type).toBe('Film Grain')
  })

  it('wraps the prior SaveImage image source as the grain image input', () => {
    const wf = makeWf()
    appendFilmGrain(wf, '99')
    expect(wf['grain:film'].inputs.image).toEqual(['det:face', 0])
  })

  it('repoints SaveImage to the grain output', () => {
    const wf = makeWf()
    appendFilmGrain(wf, '99')
    expect(wf['99'].inputs.images).toEqual(['grain:film', 0])
  })

  it('keeps repeats at 1 so the batch is not tiled', () => {
    const wf = makeWf()
    appendFilmGrain(wf, '99')
    expect(wf['grain:film'].inputs.repeats).toBe(1)
  })

  it('uses subtle grain defaults', () => {
    const wf = makeWf()
    appendFilmGrain(wf, '99')
    expect(wf['grain:film'].inputs.intensity).toBe(0.04)
    expect(wf['grain:film'].inputs.density).toBe(0.4)
    expect(wf['grain:film'].inputs.highlights).toBe(1.0)
  })

  it('honors an explicit intensity/density override', () => {
    const wf = makeWf()
    appendFilmGrain(wf, '99', { intensity: 0.08, density: 0.6 })
    expect(wf['grain:film'].inputs.intensity).toBe(0.08)
    expect(wf['grain:film'].inputs.density).toBe(0.6)
  })

  it('composes after an upscale output when no detailer ran', () => {
    const wf = makeWf()
    wf['99'].inputs.images = ['upscale_out', 0]
    appendFilmGrain(wf, '99')
    expect(wf['grain:film'].inputs.image).toEqual(['upscale_out', 0])
    expect(wf['99'].inputs.images).toEqual(['grain:film', 0])
  })
})
