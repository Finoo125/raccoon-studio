import { describe, it, expect } from 'vitest'
import { applyExpertSampler, negativePromptApplies } from './expert-sampler'
import { workflows, getWorkflow } from './index'
import type { ComfyUIPrompt } from '@/types/comfyui'
import type { GenerationParams } from '@/types/workflow'

const BASE: GenerationParams = { prompt: 'a raccoon', width: 832, height: 1216, seed: 7 }

/** Main sampler + the two nodes the pass must leave alone. */
function graph(): ComfyUIPrompt {
  return {
    '3': {
      class_type: 'KSampler',
      inputs: { steps: 30, cfg: 7, sampler_name: 'dpmpp_2m_sde', scheduler: 'karras', denoise: 1 },
    },
    'hires:sample': {
      class_type: 'KSampler',
      inputs: { steps: 12, cfg: 7, sampler_name: 'dpmpp_2m_sde', scheduler: 'karras', denoise: 0.2 },
    },
    'det:face': {
      class_type: 'FaceDetailer',
      inputs: { steps: 30, cfg: 7, sampler_name: 'dpmpp_2m_sde', scheduler: 'karras', denoise: 0.15 },
    },
  } as unknown as ComfyUIPrompt
}

const EXPERT = { expertMode: true, steps: 45, cfg: 3.5, sampler: 'euler_ancestral', scheduler: 'normal' }

describe('applyExpertSampler', () => {
  it('is a no-op with expert mode off, even when the values are set', () => {
    const before = graph()
    const after = applyExpertSampler(graph(), { ...BASE, ...EXPERT, expertMode: false })
    expect(after).toEqual(before)
  })

  it('is a no-op when expertMode is absent', () => {
    const after = applyExpertSampler(graph(), { ...BASE, steps: 45, cfg: 3.5 })
    expect(after['3'].inputs.steps).toBe(30)
    expect(after['3'].inputs.cfg).toBe(7)
  })

  it('overwrites all four values on the main sampler', () => {
    const wf = applyExpertSampler(graph(), { ...BASE, ...EXPERT })
    expect(wf['3'].inputs).toMatchObject({
      steps: 45,
      cfg: 3.5,
      sampler_name: 'euler_ancestral',
      scheduler: 'normal',
      // untouched
      denoise: 1,
    })
  })

  it('leaves the hires-fix resample and the face detailer alone', () => {
    const wf = applyExpertSampler(graph(), { ...BASE, ...EXPERT })
    expect(wf['hires:sample'].inputs).toEqual(graph()['hires:sample'].inputs)
    expect(wf['det:face'].inputs).toEqual(graph()['det:face'].inputs)
  })

  it('writes only the values that are set', () => {
    const wf = applyExpertSampler(graph(), { ...BASE, expertMode: true, cfg: 2 })
    expect(wf['3'].inputs.cfg).toBe(2)
    expect(wf['3'].inputs.steps).toBe(30)
    expect(wf['3'].inputs.sampler_name).toBe('dpmpp_2m_sde')
    expect(wf['3'].inputs.scheduler).toBe('karras')
  })

  it('accepts cfg 0 and treats it as set (0 is a real CFG, not "unset")', () => {
    const wf = applyExpertSampler(graph(), { ...BASE, expertMode: true, cfg: 0 })
    expect(wf['3'].inputs.cfg).toBe(0)
  })
})

describe('negativePromptApplies', () => {
  const turbo = { supportsNegativePrompt: false, defaultParams: { cfg: 1 } }
  const full = { supportsNegativePrompt: true, defaultParams: { cfg: 7 } }

  it('follows the family when expert mode is off', () => {
    expect(negativePromptApplies({ ...BASE, cfg: 9 }, turbo)).toBe(false)
    expect(negativePromptApplies(BASE, full)).toBe(true)
  })

  it('follows CFG when expert mode is on', () => {
    expect(negativePromptApplies({ ...BASE, expertMode: true, cfg: 3 }, turbo)).toBe(true)
    expect(negativePromptApplies({ ...BASE, expertMode: true, cfg: 1 }, full)).toBe(false)
  })

  it('treats CFG 1 exactly as "no uncond pass"', () => {
    expect(negativePromptApplies({ ...BASE, expertMode: true, cfg: 1 }, turbo)).toBe(false)
    expect(negativePromptApplies({ ...BASE, expertMode: true, cfg: 1.1 }, turbo)).toBe(true)
  })

  it('falls back to the family default when cfg is unset', () => {
    expect(negativePromptApplies({ ...BASE, expertMode: true }, turbo)).toBe(false)
    expect(negativePromptApplies({ ...BASE, expertMode: true }, full)).toBe(true)
  })
})

describe('expert mode through the workflow registry', () => {
  // Every registered family must honour Expert Mode — the point of applying it at
  // registration rather than per builder. Params that suit all of them: no LoRAs,
  // no base image, upscale/detailer left at their defaults.
  it.each(workflows.map((w) => w.id))('%s honours expert overrides', (id) => {
    const wf = getWorkflow(id)!.buildPrompt({ ...BASE, ...EXPERT })
    const main = Object.entries(wf).filter(
      ([nodeId, n]) => n.class_type === 'KSampler' && !nodeId.startsWith('hires:'),
    )
    expect(main.length).toBeGreaterThan(0)
    for (const [, node] of main) {
      expect(node.inputs.steps).toBe(45)
      expect(node.inputs.cfg).toBe(3.5)
      expect(node.inputs.sampler_name).toBe('euler_ancestral')
      expect(node.inputs.scheduler).toBe('normal')
    }
  })

  it.each(workflows.map((w) => w.id))('%s ignores the values with expert mode off', (id) => {
    const w = getWorkflow(id)!
    const off = w.buildPrompt({ ...BASE, ...EXPERT, expertMode: false })
    // Falls back to the family's own budget, which defaultParams also advertises.
    const [, main] = Object.entries(off).find(
      ([nodeId, n]) => n.class_type === 'KSampler' && !nodeId.startsWith('hires:'),
    )!
    expect(main.inputs.steps).toBe(w.defaultParams.steps)
    expect(main.inputs.cfg).toBe(w.defaultParams.cfg)
    expect(main.inputs.sampler_name).toBe(w.defaultParams.sampler)
    expect(main.inputs.scheduler).toBe(w.defaultParams.scheduler)
  })
})
