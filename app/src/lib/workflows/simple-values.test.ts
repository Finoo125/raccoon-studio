import { describe, expect, it } from 'vitest'
import { getWorkflow, workflows } from './index'
import { ltx23Workflow } from './ltx23'
import { simpleLtxSettings } from '@/lib/prompt-builder/video-picks'
import type { VideoGenerationParams } from '@/types/video-workflow'
import {
  IMAGE_KEYS, VIDEO_KEYS, advancedImageReasons, advancedVideoReasons, shapeOf, simpleImageValues, simplePresetIds, simpleShapes,
  simpleVideoMode, simpleVideoValues,
} from './simple-values'

const anima = getWorkflow('anima-turbo')!
const krea2 = getWorkflow('krea2-turbo')!

describe('simpleImageValues', () => {
  it('turns every Advanced-only setting off and keeps what Simple shows', () => {
    const v = simpleImageValues(krea2)
    expect(v).toMatchObject({
      expertMode: false, loras: [], seed: -1, jobCount: 1, faceSwap: false, tiledVaeDecode: false,
      promptEnhancer: false, krea2Nsfw: 'patch',
    })
    expect(v.baseImage).toBeUndefined()
    expect(v.controlNet).toBeUndefined()
    // Simple shows these, so the overlay must not touch them
    for (const kept of ['prompt', 'width', 'height', 'upscale', 'detailer', 'batchSize', 'ariaModel'] as const) {
      expect(kept in v).toBe(false)
    }
  })
  it('Edit keeps its pictures and task; the head-swap build is the default', () => {
    const v = simpleImageValues(getWorkflow('qwen21-edit')!)
    expect('qwenReferences' in v).toBe(false)
    expect('editChip' in v).toBe(false)
    expect('bfsVariant' in v).toBe(true)
    expect(v.bfsVariant).toBeUndefined()
  })
  it("uses the preset's own negative prompt", () => {
    expect(simpleImageValues(anima).negativePrompt).toBe(anima.defaultParams.negativePrompt ?? '')
  })
})

describe('simpleVideoMode / simpleVideoValues', () => {
  it('Edit and Director render as text-to-video in Simple', () => {
    expect(simpleVideoMode('director')).toBe('t2v')
    expect(simpleVideoMode('edit')).toBe('t2v')
    expect(simpleVideoMode('ref2v')).toBe('ref2v')
  })
  const p = {
    prompt: 'x', mode: 'director', durationSeconds: 8, fps: 24, seed: 7,
    lora1: 'a.safetensors', endImage: 'e.png', keyframes: { start: { image: 'k.png' } }, refHiFi: true,
    filmGrain: true, refImages: ['r.png'], vramMode: 'medium', turbo: 'fast',
  } as unknown as VideoGenerationParams
  it('drops every Advanced-only setting, keeps references, size, length and speed', () => {
    const v = simpleVideoValues(p, { motionReady: true })
    expect(v).toMatchObject({ mode: 't2v', lora1: '', seed: -1, seedHunt: false, refHiFi: false, motionLora: true })
    expect(v.endImage).toBeUndefined()
    expect(v.keyframes).toBeUndefined()
    expect(v.filmGrain).toBeUndefined()
    for (const kept of ['refImages', 'vramMode', 'turbo', 'durationSeconds', 'orientation', 'inputImage', 'continueFrom'] as const) {
      expect(kept in v).toBe(false)
    }
  })
  it('turns the H3 realism adapter on only where its LoRA is installed', () => {
    expect(simpleVideoValues(p, { motionReady: false, realismReady: true }).realismLora).toBe(true)
    expect(simpleVideoValues(p, { motionReady: false, realismReady: false }).realismLora).toBe(false)
    expect(simpleVideoValues(p, { motionReady: false }).realismLora).toBe(false)
  })
})

describe('the hidden-keys guard (spec §4)', () => {
  it('the image overlay sets exactly the settings Simple hides, on every preset', () => {
    for (const w of workflows) {
      const v = simpleImageValues(w)
      for (const [k, place] of Object.entries(IMAGE_KEYS)) expect(k in v, `${w.id}: ${k}`).toBe(place === 'reset')
    }
  })
  it('the video overlay sets exactly the settings Simple hides', () => {
    const v = simpleVideoValues({ mode: 'edit', prompt: 'x', durationSeconds: 5, fps: 24 } as VideoGenerationParams, { motionReady: false })
    for (const [k, place] of Object.entries(VIDEO_KEYS)) expect(k in v, k).toBe(place === 'reset')
  })
})

describe('advancedImageReasons', () => {
  it('an ordinary picture (default negative, fixed seed) stays in Simple', () => {
    expect(advancedImageReasons({ prompt: 'a cat', negativePrompt: anima.defaultParams.negativePrompt, seed: 42 }, anima)).toEqual([])
  })
  it('names what needs Advanced, once each', () => {
    expect(advancedImageReasons({
      loras: [{ name: 'x.safetensors', strength: 1 }], expertMode: true, faceSwap: true,
      krea2Nsfw: 'kroma', krea2KromaStrength: 0.5,
    }, krea2)).toEqual(['LoRAs', 'Expert mode', 'face swap', 'NSFW settings'])
  })
  it('empty LoRA rows are not LoRAs', () => {
    expect(advancedImageReasons({ loras: [{ name: '', strength: 1 }] }, anima)).toEqual([])
  })
  it("another family's leftovers are no reason: Krea2 NSFW fields on Z-Image, edit pictures on a text-to-image preset", () => {
    const zimage = getWorkflow('z-image-turbo')!
    expect(advancedImageReasons({ krea2Nsfw: 'kroma', krea2KromaStrength: 0.5 }, zimage)).toEqual([])
    expect(advancedImageReasons({ qwenReferences: ['a.png'], editChip: 'sheet' }, zimage)).toEqual([])
  })
})

describe('advancedImageReasons on the Edit preset', () => {
  const edit = getWorkflow('qwen21-edit')!
  it('pictures, a character sheet and the default head swap stay in Simple', () => {
    expect(advancedImageReasons({ qwenReferences: ['a.png', 'b.png'], editChip: 'bfs', bfsVariant: 'alternative' }, edit)).toEqual([])
    expect(advancedImageReasons({ qwenReferences: ['a.png'], editChip: 'sheet' }, edit)).toEqual([])
  })
  it('the v1.1 head swap needs Advanced (Simple always uses Alternative)', () => {
    expect(advancedImageReasons({ qwenReferences: ['a.png', 'b.png'], editChip: 'bfs', bfsVariant: 'v1.1' }, edit)).toEqual(['the v1.1 head swap'])
  })
})

describe('advancedVideoReasons', () => {
  it('a plain clip continues in Simple', () => {
    expect(advancedVideoReasons({ mode: 'i2v', inputImage: 'a.png', seed: 3 })).toEqual([])
  })
  it('names Edit, an end frame, LoRAs and a seed hunt', () => {
    expect(advancedVideoReasons({ mode: 'edit', endImage: 'e.png', lora2: 'x.safetensors' }, 3))
      .toEqual(['Edit video', 'an end frame', 'LoRAs', 'several takes'])
  })
})

describe('shapes', () => {
  it('reads the shape off the size', () => {
    expect(shapeOf(832, 1216)).toBe('portrait')
    expect(shapeOf(1024, 1024)).toBe('square')
    expect(shapeOf(1216, 832)).toBe('landscape')
  })
  it('picks the "Portrait / Square / Landscape" entry of a preset', () => {
    const s = simpleShapes(krea2.aspectRatios)
    expect(s.map((x) => x.shape)).toEqual(['portrait', 'square', 'landscape'])
    expect(s[0].ratio.label.startsWith('Portrait')).toBe(true)
    expect(s[2].ratio.label.startsWith('Landscape')).toBe(true)
  })
  it('a preset without a square ratio offers two shapes', () => {
    const s = simpleShapes([
      { label: 'Story 9:16', width: 768, height: 1344 },
      { label: 'Wide 16:9', width: 1344, height: 768 },
    ])
    expect(s.map((x) => x.shape)).toEqual(['portrait', 'landscape'])
  })
})

describe('simplePresetIds', () => {
  const order = ['krea2-turbo', 'anima-turbo', 'anima', 'krea2-turbo', 'qwen21-edit', 'sdxl-pony']
  const usable = (id: string) => id !== 'anima'
  it('lists usable presets in order, once — picture editing included', () => {
    expect(simplePresetIds(order, usable, 'krea2-turbo')).toEqual(['krea2-turbo', 'anima-turbo', 'qwen21-edit', 'sdxl-pony'])
  })
  it('always includes the current pick, even when it is not usable', () => {
    expect(simplePresetIds(order, usable, 'anima')).toEqual(['krea2-turbo', 'anima-turbo', 'qwen21-edit', 'sdxl-pony', 'anima'])
  })
})

describe('Simple LTX render matches the writer', () => {
  const advanced = {
    prompt: 'x', mode: 't2v', orientation: 'landscape', durationSeconds: 5, fps: 24, seed: 1,
    pov: true, povGender: 'male', dialogueTier: 'talkative', music: 'Hip-Hop / Rap — heavy 808s & crisp hi-hats',
  } as unknown as VideoGenerationParams
  it('pins no POV, standard talking and no music on the prompt node', () => {
    const laid = { ...advanced, ...simpleVideoValues(advanced, { motionReady: false }) }
    const wf = Object.values(ltx23Workflow.buildPrompt(laid) as unknown as Record<string, { class_type: string; inputs: Record<string, unknown> }>)
    const n = wf.find((x) => x.class_type === 'RaccoonVideoPrompt')!
    expect(n.inputs.pov).toBe(false)
    expect(n.inputs.dialogue_tier).toBe('standard')
    expect(String(n.inputs.music)).toMatch(/^None/)
  })
  it('agrees with what simpleLtxSettings tells the writer', () => {
    const o = simpleVideoValues(advanced, { motionReady: false })
    const w = simpleLtxSettings({ pov: true, dialogueTier: 'talkative' } as never, { music: ['None — LLM decides'] } as never)
    expect(w.pov).toBe(o.pov)
    expect(w.dialogueTier).toBe(o.dialogueTier)
    expect(w.music).toMatch(/^None/)
  })
})
