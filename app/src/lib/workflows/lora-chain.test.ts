import { describe, it, expect } from 'vitest'
import { selectedLoras, prependLoraChain, LORA_SLOTS, EMPTY_LORA_PARAMS, MAX_LORAS, FREE_LORA_SLOTS } from './lora-chain'
import { animaWorkflow } from './anima'
import { zImageTurboWorkflow } from './z-image-turbo'
import { ernieTurboWorkflow } from './ernie-turbo'
import { sdxlWorkflow } from './sdxl'
import type { ComfyUIPrompt } from '@/types/comfyui'
import type { GenerationParams } from '@/types/workflow'

const base: GenerationParams = { prompt: 'a raccoon', width: 832, height: 1216, seed: 1 }

const five = {
  lora1: 'one.safetensors', lora1Strength: 0.1,
  lora2: 'two.safetensors', lora2Strength: 0.2,
  lora3: 'three.safetensors', lora3Strength: 0.3,
  lora4: 'four.safetensors', lora4Strength: 0.4,
  lora5: 'five.safetensors', lora5Strength: 0.5,
}

/**
 * Every LoRA filename the built graph actually references, from any loader style
 * (rgthree stack slots, LoraLoader, LoraLoaderModelOnly). A name missing here is
 * a LoRA the user picked and the backend will never apply.
 */
function loraNamesIn(wf: ComfyUIPrompt): string[] {
  const found: string[] = []
  for (const node of Object.values(wf)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (/^lora(_name|_0\d)$/.test(key) && typeof value === 'string' && value !== 'None') found.push(value)
    }
  }
  return found.sort()
}

describe('selectedLoras', () => {
  it('returns only the set slots, in order', () => {
    expect(selectedLoras({ ...base, ...five }).map((l) => l.name)).toEqual([
      'one.safetensors', 'two.safetensors', 'three.safetensors', 'four.safetensors', 'five.safetensors',
    ])
  })

  it('compacts gaps so an empty middle slot leaves no hole', () => {
    const picked = selectedLoras({ ...base, lora1: 'a.safetensors', lora4: 'd.safetensors', lora4Strength: 0.5 })
    expect(picked).toEqual([{ name: 'a.safetensors', strength: undefined }, { name: 'd.safetensors', strength: 0.5 }])
  })

  it('is empty when nothing is picked', () => {
    expect(selectedLoras(base)).toEqual([])
  })
})

describe('prependLoraChain', () => {
  it('chains model + clip and returns the tail', () => {
    const wf: ComfyUIPrompt = {}
    const out = prependLoraChain(
      wf,
      [{ name: 'a.safetensors', strength: 0.5 }, { name: 'b.safetensors' }],
      { model: ['base', 0], clip: ['base', 1] },
      'lora:x',
    )
    expect(wf['lora:x:0'].class_type).toBe('LoraLoader')
    expect(wf['lora:x:0'].inputs).toMatchObject({
      lora_name: 'a.safetensors', strength_model: 0.5, strength_clip: 0.5, model: ['base', 0], clip: ['base', 1],
    })
    // Second link reads the first, not the original source.
    expect(wf['lora:x:1'].inputs).toMatchObject({ model: ['lora:x:0', 0], clip: ['lora:x:0', 1] })
    // Missing strength falls back to full weight.
    expect(wf['lora:x:1'].inputs.strength_model).toBe(1)
    expect(out).toEqual({ model: ['lora:x:1', 0], clip: ['lora:x:1', 1] })
  })

  it('builds model-only loaders when no clip is supplied', () => {
    const wf: ComfyUIPrompt = {}
    const out = prependLoraChain(wf, [{ name: 'a.safetensors' }], { model: ['base', 0] }, 'lora:x')
    expect(wf['lora:x:0'].class_type).toBe('LoraLoaderModelOnly')
    expect(wf['lora:x:0'].inputs).not.toHaveProperty('clip')
    expect(out).toEqual({ model: ['lora:x:0', 0], clip: undefined })
  })

  it('is a no-op for an empty list', () => {
    const wf: ComfyUIPrompt = {}
    expect(prependLoraChain(wf, [], { model: ['base', 0], clip: ['base', 1] }, 'lora:x'))
      .toEqual({ model: ['base', 0], clip: ['base', 1] })
    expect(Object.keys(wf)).toEqual([])
  })
})

describe('every image workflow applies all five slots', () => {
  const expected = ['five.safetensors', 'four.safetensors', 'one.safetensors', 'three.safetensors', 'two.safetensors']

  it.each([
    ['anima', animaWorkflow],
    ['z-image', zImageTurboWorkflow],
    ['ernie', ernieTurboWorkflow],
    ['sdxl', sdxlWorkflow],
  ])('%s', (_name, workflow) => {
    expect(loraNamesIn(workflow.buildPrompt({ ...base, ...five }))).toEqual(expected)
  })
})

describe('per-family wiring', () => {
  it('Anima chains slots 2+ upstream of its single-slot loader', () => {
    // Regression: Anima's LoraLoaderModelOnly holds one LoRA, and every slot past
    // the first used to be dropped on the floor without a word.
    const wf = animaWorkflow.buildPrompt({ ...base, lora1: 'a.safetensors', lora2: 'b.safetensors' })
    expect(wf['60:61'].inputs.lora_name).toBe('a.safetensors')
    expect(wf['lora:x:0'].inputs.lora_name).toBe('b.safetensors')
    // The chain sits between the UNETLoader and 60:61, so downstream is untouched.
    expect(wf['lora:x:0'].inputs.model).toEqual(['60:44', 0])
    expect(wf['60:61'].inputs.model).toEqual(['lora:x:0', 0])
  })

  it('Anima still bypasses its loader when nothing is picked', () => {
    const wf = animaWorkflow.buildPrompt(base)
    expect(wf['60:61']).toBeUndefined()
    expect(wf['lora:x:0']).toBeUndefined()
    expect(wf['60:19'].inputs.model).toEqual(['60:44', 0])
  })

  it.each([
    ['z-image', zImageTurboWorkflow, '57:62', ['57:28', 0], ['57:30', 0]],
    ['ernie', ernieTurboWorkflow, '88:104', ['88:66', 0], ['88:62', 0]],
  ])('%s fills the four stack slots and chains the fifth upstream', (_n, workflow, stackId, model, clip) => {
    const wf = workflow.buildPrompt({ ...base, ...five })
    expect(wf[stackId].inputs.lora_01).toBe('one.safetensors')
    expect(wf[stackId].inputs.lora_04).toBe('four.safetensors')
    // Fifth has no slot, so it becomes a loader feeding the stack's inputs.
    expect(wf['lora:x:0'].inputs.lora_name).toBe('five.safetensors')
    expect(wf['lora:x:0'].inputs.model).toEqual(model)
    expect(wf['lora:x:0'].inputs.clip).toEqual(clip)
    expect(wf[stackId].inputs.model).toEqual(['lora:x:0', 0])
    expect(wf[stackId].inputs.clip).toEqual(['lora:x:0', 1])
  })

  it.each([
    ['z-image', zImageTurboWorkflow, '57:62'],
    ['ernie', ernieTurboWorkflow, '88:104'],
  ])('%s blanks unused stack slots and adds no chain', (_n, workflow, stackId) => {
    const wf = workflow.buildPrompt({ ...base, lora1: 'a.safetensors' })
    expect(wf[stackId].inputs.lora_01).toBe('a.safetensors')
    expect(wf[stackId].inputs.lora_02).toBe('None')
    expect(wf[stackId].inputs.lora_03).toBe('None')
    expect(wf[stackId].inputs.lora_04).toBe('None')
    expect(wf['lora:x:0']).toBeUndefined()
  })

  it('SDXL chains all five and points the sampler at the tail', () => {
    const wf = sdxlWorkflow.buildPrompt({ ...base, ...five })
    expect(wf['100'].inputs.lora_name).toBe('one.safetensors')
    expect(wf['104'].inputs.lora_name).toBe('five.safetensors')
    expect(wf['3'].inputs.model).toEqual(['104', 0])
  })
})

describe('slot metadata', () => {
  it('exposes one entry per slot up to the ceiling', () => {
    expect(LORA_SLOTS).toHaveLength(MAX_LORAS)
    expect(FREE_LORA_SLOTS).toBeLessThan(MAX_LORAS)
  })

  it('EMPTY_LORA_PARAMS clears every slot', () => {
    const cleared = { ...five, ...EMPTY_LORA_PARAMS } as GenerationParams
    expect(selectedLoras(cleared)).toEqual([])
    for (const slot of LORA_SLOTS) expect(cleared[slot.strength]).toBe(1)
  })
})
