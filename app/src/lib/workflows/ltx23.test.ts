import { describe, it, expect } from 'vitest'
import { ltx23Workflow, ltxDimsForImage } from './ltx23'
import type { VideoGenerationParams } from '@/types/video-workflow'
import type { ComfyUIPrompt, ComfyUIPromptNode } from '@/types/comfyui'

type Wf = Record<string, ComfyUIPromptNode>

/** The single node of `cls` in the built prompt — fails the test if not exactly one. */
function byClass(wf: ComfyUIPrompt, cls: string): ComfyUIPromptNode {
  const hits = Object.values(wf as Wf).filter((n) => n.class_type === cls)
  expect(hits, cls).toHaveLength(1)
  return hits[0]
}

const base: VideoGenerationParams = {
  prompt: 'a raccoon dancing in the rain',
  mode: 't2v',
  orientation: 'landscape',
  durationSeconds: 15,
  fps: 30,
  seed: 42,
}

describe('ltx23Workflow.buildPrompt', () => {
  it('feeds prompt/mode into the RaccoonVideoPrompt node', () => {
    const n = byClass(ltx23Workflow.buildPrompt(base), 'RaccoonVideoPrompt')
    expect(n.inputs.confirmed_prompt).toBe(base.prompt)
    expect(n.inputs.video_mode).toBe('t2v')
    expect(n.inputs.image_filename).toBe('')
  })

  it('maps t2v orientations to exact /32 dimensions', () => {
    const dims = (o: string) => {
      const n = byClass(ltx23Workflow.buildPrompt({ ...base, orientation: o }), 'RaccoonVideoPrompt')
      return [n.inputs.rm_w, n.inputs.rm_h]
    }
    expect(dims('portrait')).toEqual([1088, 1920])
    expect(dims('landscape')).toEqual([1920, 1088])
    expect(dims('square')).toEqual([1024, 1024])
  })

  it('sets i2v image + aspect-preserving snapped dims from the source image', () => {
    const n = byClass(
      ltx23Workflow.buildPrompt({
        ...base,
        mode: 'i2v',
        inputImage: 'sub/seed.png',
        inputImageWidth: 3000,
        inputImageHeight: 2000,
      }),
      'RaccoonVideoPrompt',
    )
    expect(n.inputs.image_filename).toBe('sub/seed.png')
    expect(n.inputs.rm_w).toBe(ltxDimsForImage(3000, 2000).w)
    expect(n.inputs.rm_h).toBe(ltxDimsForImage(3000, 2000).h)
  })

  it('keeps the exported default dims for i2v without recorded image dims', () => {
    const n = byClass(
      ltx23Workflow.buildPrompt({ ...base, mode: 'i2v', inputImage: 'seed.png' }),
      'RaccoonVideoPrompt',
    )
    expect(n.inputs.rm_w).toBe(1088)
    expect(n.inputs.rm_h).toBe(1920)
  })

  it('halves the pixel budget in low VRAM mode', () => {
    const dims = (o: string) => {
      const n = byClass(
        ltx23Workflow.buildPrompt({ ...base, orientation: o, vramMode: 'low' }),
        'RaccoonVideoPrompt',
      )
      return [n.inputs.rm_w, n.inputs.rm_h]
    }
    expect(dims('portrait')).toEqual([736, 1312])
    expect(dims('landscape')).toEqual([1312, 736])
    expect(dims('square')).toEqual([1024, 1024]) // already ~1MP

    const n = byClass(
      ltx23Workflow.buildPrompt({
        ...base,
        mode: 'i2v',
        inputImage: 'seed.png',
        inputImageWidth: 3000,
        inputImageHeight: 2000,
        vramMode: 'low',
      }),
      'RaccoonVideoPrompt',
    )
    expect(n.inputs.rm_w).toBe(ltxDimsForImage(3000, 2000, 1).w)
    expect(n.inputs.rm_h).toBe(ltxDimsForImage(3000, 2000, 1).h)
  })

  it('evicts models after text encode: a clean-VRAM node feeds the first-pass sampler', () => {
    const wf = ltx23Workflow.buildPrompt(base) as unknown as Wf
    const samplers = Object.values(wf).filter((n) => n.class_type === 'SamplerCustom')
    expect(samplers.length).toBeGreaterThan(0)
    const cleaned = samplers.filter((s) => {
      const pos = s.inputs.positive as [string, number]
      return wf[pos[0]]?.class_type === 'easy cleanGpuUsed'
    })
    expect(cleaned).toHaveLength(1)
  })

  it('hard-wires the DMD LoRA as row 0 and defaults user slots to none', () => {
    const stack = JSON.parse(
      byClass(ltx23Workflow.buildPrompt(base), 'RaccoonLoraStack').inputs.stack_data as string,
    )
    expect(stack[0]).toEqual({ on: true, lora: 'LTX2.3_DMD_reshaped_r256.safetensors', str: 1, vs: 1, as: 0.8 })
    expect(stack).toHaveLength(1)
  })

  it('appends user LoRA rows with their strength', () => {
    const stack = JSON.parse(
      byClass(
        ltx23Workflow.buildPrompt({
          ...base,
          lora1: 'styleA.safetensors',
          lora1Strength: 0.7,
          lora3: 'styleC.safetensors',
        }),
        'RaccoonLoraStack',
      ).inputs.stack_data as string,
    )
    expect(stack).toHaveLength(3)
    expect(stack[1]).toEqual({ on: true, lora: 'styleA.safetensors', str: 0.7, vs: 1, as: 1 })
    expect(stack[2]).toEqual({ on: true, lora: 'styleC.safetensors', str: 1, vs: 1, as: 1 })
  })

  it('writes pov/gender/music and preset passthroughs to the node', () => {
    const n = byClass(
      ltx23Workflow.buildPrompt({
        ...base,
        pov: true,
        povGender: 'male',
        music: 'None',
        dialogueTier: 'talkative',
        energy: 8,
      }),
      'RaccoonVideoPrompt',
    )
    expect(n.inputs.pov).toBe(true)
    expect(n.inputs.pov_gender).toBe('male')
    expect(n.inputs.music).toBe('None')
    expect(n.inputs.dialogue_tier).toBe('talkative')
    expect(n.inputs.intensity).toBe(8)
  })

  it('writes duration and fps to their source nodes', () => {
    const wf = ltx23Workflow.buildPrompt({ ...base, durationSeconds: 8, fps: 25 }) as unknown as Wf
    const prompt = byClass(wf as unknown as ComfyUIPrompt, 'RaccoonVideoPrompt')
    const durRef = prompt.inputs.duration_s as [string, number]
    const fpsRef = prompt.inputs.fps as [string, number]
    expect(wf[durRef[0]].inputs.value).toBe(8)
    expect(wf[fpsRef[0]].inputs.value).toBe(25)
  })

  it('applies a concrete seed and resolves negative seeds', () => {
    const seedNode = byClass(ltx23Workflow.buildPrompt({ ...base, seed: 12345 }), 'Seed (rgthree)')
    expect(seedNode.inputs.seed).toBe(12345)
    const rnd = byClass(ltx23Workflow.buildPrompt({ ...base, seed: -1 }), 'Seed (rgthree)').inputs
      .seed as number
    expect(Number.isInteger(rnd)).toBe(true)
    expect(rnd).toBeGreaterThanOrEqual(0)
  })

  it('sets the dated output prefix on the saving VideoCombine', () => {
    const wf = ltx23Workflow.buildPrompt(base) as unknown as Wf
    const savers = Object.values(wf).filter(
      (n) => n.class_type === 'VHS_VideoCombine' && n.inputs.save_output === true,
    )
    expect(savers).toHaveLength(1)
    expect(savers[0].inputs.filename_prefix).toBe(
      'video/LTX23/%year%-%month%-%day%/%hour%%minute%%second%-LTX23_',
    )
  })

  it('keeps RIFE interpolation in the graph by default', () => {
    const wf = ltx23Workflow.buildPrompt(base) as unknown as Wf
    expect(Object.values(wf).some((n) => n.class_type === 'RIFEInterpolation')).toBe(true)
  })

  it('splices RIFE out (images + frame_rate rewired) when rife is false', () => {
    const withRife = ltx23Workflow.buildPrompt(base) as unknown as Wf
    const rifeNode = byClass(withRife as unknown as ComfyUIPrompt, 'RIFEInterpolation')

    const wf = ltx23Workflow.buildPrompt({ ...base, rife: false }) as unknown as Wf
    expect(Object.values(wf).some((n) => n.class_type === 'RIFEInterpolation')).toBe(false)
    const saver = Object.values(wf).find(
      (n) => n.class_type === 'VHS_VideoCombine' && n.inputs.save_output === true,
    )!
    expect(saver.inputs.images).toEqual(rifeNode.inputs.images)
    expect(saver.inputs.frame_rate).toEqual(rifeNode.inputs.source_fps)
  })

  it('tolerates legacy stored params (rerun of pre-v2 jobs)', () => {
    const legacy = { ...base, shotType: 'TRACKING' } as VideoGenerationParams & { shotType: string }
    expect(() => ltx23Workflow.buildPrompt(legacy)).not.toThrow()
  })
})

describe('ltxDimsForImage', () => {
  it('preserves aspect at ~2MP snapped to /32', () => {
    const { w, h } = ltxDimsForImage(3000, 2000)
    expect(w % 32).toBe(0)
    expect(h % 32).toBe(0)
    expect(Math.abs(w / h - 1.5)).toBeLessThan(0.1)
    expect(Math.abs((w * h) / (1024 * 1024) - 2)).toBeLessThan(0.25)
  })

  it('honours a reduced pixel budget', () => {
    const { w, h } = ltxDimsForImage(3000, 2000, 1)
    expect(w % 32).toBe(0)
    expect(h % 32).toBe(0)
    expect(Math.abs((w * h) / (1024 * 1024) - 1)).toBeLessThan(0.2)
  })

  it('never returns dimensions below the 32px grid floor', () => {
    const { w, h } = ltxDimsForImage(10000, 10)
    expect(w).toBeGreaterThanOrEqual(32)
    expect(h).toBeGreaterThanOrEqual(32)
  })
})
