import { describe, it, expect } from 'vitest'
import { switchPresetParams } from './preset-switch'
import { workflows } from '@/lib/workflows'
import type { GenerationParams } from '@/types/workflow'

const wf = (id: string) => workflows.find((w) => w.id === id)!

describe('switchPresetParams', () => {
  // Final review 2026-10-02: a gallery "Edit with Qwen" link used to skip the
  // session restore, so the form ran on Anima's defaults and the persist effect
  // overwrote the saved session — LoRAs, tiled VAE decode, job count all gone.
  // The link now restores the session and switches to the Edit preset with this.
  it('keeps the session settings a switch does not own, and takes the target preset defaults', () => {
    const anima = wf('anima')
    const saved = {
      ...anima.defaultParams, prompt: `${anima.defaultParams.prompt}a fox`,
      tiledVaeDecode: true, jobCount: 3, detailer: false, cfg: 4.5,
      loras: [{ name: 'anima-style.safetensors', strength: 0.8 }],
    } as GenerationParams
    const p = switchPresetParams(saved, anima, wf('qwen21-edit'), undefined)
    expect(p).toMatchObject({ tiledVaeDecode: true, jobCount: 3, detailer: false, cfg: 1, steps: 6, sampler: 'euler' })
    // Anima's quality prefix goes, the description stays.
    expect(p.prompt).toBe('a fox')
    // An Anima LoRA cannot load on Qwen: the Edit preset's own (none yet) comes back.
    expect(p.loras?.every((l) => !l.name)).toBe(true)
  })

  it('keeps the LoRA stack between presets of one family', () => {
    const turbo = wf('qwen21-turbo')
    const saved = { ...turbo.defaultParams, prompt: 'x', loras: [{ name: 'qwen-style.safetensors', strength: 0.6 }] } as GenerationParams
    expect(switchPresetParams(saved, turbo, wf('qwen21-edit'), undefined).loras)
      .toEqual([{ name: 'qwen-style.safetensors', strength: 0.6 }])
  })

  it('brings back the target preset\'s stashed stack across families', () => {
    const stash = [{ name: 'mine.safetensors', strength: 1 }]
    const saved = { ...wf('anima').defaultParams, prompt: 'x' } as GenerationParams
    expect(switchPresetParams(saved, wf('anima'), wf('qwen21-edit'), stash).loras).toBe(stash)
  })
})
