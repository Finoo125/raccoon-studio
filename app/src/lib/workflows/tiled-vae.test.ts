import { describe, it, expect } from 'vitest'
import { applyTiledVaeDecode } from './tiled-vae'
import { getWorkflow, workflows } from './index'
import type { ComfyUIPrompt } from '@/types/comfyui'
import type { GenerationParams } from '@/types/workflow'

const baseParams: GenerationParams = { prompt: 'a raccoon', seed: 1, cfg: 7 } as GenerationParams

function graph(): ComfyUIPrompt {
  return {
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    'hires:decode': { class_type: 'VAEDecode', inputs: { samples: ['hires:sample', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['hires:decode', 0] } },
  }
}

describe('applyTiledVaeDecode', () => {
  it('leaves the graph untouched when the option is off', () => {
    expect(applyTiledVaeDecode(graph(), baseParams)).toEqual(graph())
  })

  it('rewrites every VAEDecode, not just the family one', () => {
    // The hires decode runs at the upscaled size, so it is the one that actually
    // OOMs a small card. Missing it would make the toggle look broken.
    const wf = applyTiledVaeDecode(graph(), { ...baseParams, tiledVaeDecode: true })
    for (const id of ['8', 'hires:decode']) {
      expect(wf[id].class_type).toBe('VAEDecodeTiled')
      expect(wf[id].inputs.tile_size).toBe(512)
    }
  })

  it('sends the video-only temporal inputs, which the node requires anyway', () => {
    // They are in VAEDecodeTiled's `required` block: omitting them fails
    // validation with a bare "Generation failed" rather than defaulting.
    const wf = applyTiledVaeDecode(graph(), { ...baseParams, tiledVaeDecode: true })
    expect(wf['8'].inputs).toMatchObject({ overlap: 64, temporal_size: 64, temporal_overlap: 8 })
  })

  it('preserves the original wiring', () => {
    const wf = applyTiledVaeDecode(graph(), { ...baseParams, tiledVaeDecode: true })
    expect(wf['8'].inputs.samples).toEqual(['3', 0])
    expect(wf['8'].inputs.vae).toEqual(['4', 2])
    expect(wf['9'].class_type).toBe('SaveImage')
  })

  it('honours the tile size picker', () => {
    const wf = applyTiledVaeDecode(graph(), { ...baseParams, tiledVaeDecode: true, tiledVaeTileSize: 384 })
    expect(wf['8'].inputs.tile_size).toBe(384)
  })

  it('touches nothing but decode nodes', () => {
    const wf = applyTiledVaeDecode(
      { '5': { class_type: 'VAEEncode', inputs: { pixels: ['1', 0] } } },
      { ...baseParams, tiledVaeDecode: true },
    )
    expect(wf['5'].class_type).toBe('VAEEncode')
    expect(wf['5'].inputs.tile_size).toBeUndefined()
  })
})

describe('every registered image family', () => {
  it('honours the toggle without its builder knowing about it', () => {
    // The whole point of wrapping at registration: this must pass for a family
    // added later without anyone touching tiled-vae.ts.
    expect(workflows.length).toBeGreaterThan(0)
    for (const wf of workflows) {
      const built = wf.buildPrompt({ ...baseParams, tiledVaeDecode: true })
      const classes = Object.values(built).map((n) => n.class_type)
      expect(classes, `${wf.id} still has a plain VAEDecode`).not.toContain('VAEDecode')
      expect(classes, `${wf.id} has no tiled decode`).toContain('VAEDecodeTiled')
    }
  })

  it('still emits plain VAEDecode when the toggle is off', () => {
    for (const wf of workflows) {
      const classes = Object.values(wf.buildPrompt({ ...baseParams })).map((n) => n.class_type)
      expect(classes, `${wf.id} tiled without being asked`).not.toContain('VAEDecodeTiled')
    }
  })

  it('keeps getWorkflow returning the wrapped definition', () => {
    // Callers resolve through getWorkflow, so an unwrapped escape here would
    // silently disable the feature for the whole app.
    const wf = getWorkflow(workflows[0].id)
    expect(wf).toBeDefined()
    const classes = Object.values(wf!.buildPrompt({ ...baseParams, tiledVaeDecode: true })).map((n) => n.class_type)
    expect(classes).toContain('VAEDecodeTiled')
  })
})
