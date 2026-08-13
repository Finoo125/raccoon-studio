import { describe, it, expect } from 'vitest'
import { videoWorkflows, getVideoWorkflow, isLtxWorkflow, supportsSeedHunt } from './video-index'
import { minimaxH3Workflow } from './minimax-h3'

describe('isLtxWorkflow', () => {
  it('covers both LTX graphs — Director rides the same builder', () => {
    expect(isLtxWorkflow('ltx23')).toBe(true)
    expect(isLtxWorkflow('ltx23-director')).toBe(true)
  })

  it('is false for MiniMax H3 and for an unknown/absent id', () => {
    expect(isLtxWorkflow('minimax-h3')).toBe(false)
    expect(isLtxWorkflow(undefined)).toBe(false)
    expect(isLtxWorkflow('')).toBe(false)
  })

  it('matches every registered workflow id, so a new model cannot fall through', () => {
    // Guards the gate itself: if a workflow is added, this forces a decision
    // about whether it supports the LTX-only form features.
    for (const w of videoWorkflows) {
      expect(isLtxWorkflow(w.id)).toBe(w.id.startsWith('ltx23'))
      expect(getVideoWorkflow(w.id)).toBe(w)
    }
  })
})

describe('the features the gate hides', () => {
  const base = {
    prompt: 'a raccoon', mode: 't2v' as const, orientation: 'landscape',
    durationSeconds: 5, fps: 24, seed: 7, vramMode: 'low' as const,
  }

  // If H3's builder ever starts reading one of these, the gate is wrong and this
  // test says so rather than leaving a dead knob hidden. RIFE and the LoRA slots
  // were on this list until H3 grew real support for both — that is what it
  // looks like when this test earns its keep.
  it('MiniMax H3 still ignores faceId and motionLora', () => {
    const plain = JSON.stringify(minimaxH3Workflow.buildPrompt(base))
    const decorated = JSON.stringify(
      minimaxH3Workflow.buildPrompt({
        ...base,
        faceId: true,
        faceIdStrength: 1.5,
        faceIdWholeSubject: true,
        motionLora: true,
      }),
    )
    expect(decorated).toBe(plain)
  })

  // rife, the LoRA slots, turbo and seedHunt were all on the ignored list until
  // H3 grew real support for each. That churn is the point of this test: it
  // forces the gate to be revisited instead of leaving a dead knob hidden.
  it('but does read rife, the LoRA slots, turbo and seedHunt', () => {
    const plain = JSON.stringify(minimaxH3Workflow.buildPrompt(base))
    for (const over of [
      { rife: true },
      { lora1: 'x.safetensors' },
      { turbo: true },
      { seedHunt: true },
    ]) {
      expect(JSON.stringify(minimaxH3Workflow.buildPrompt({ ...base, ...over }))).not.toBe(plain)
    }
  })

  it('every workflow offering a seed hunt actually makes the candidate cheaper', () => {
    for (const w of videoWorkflows) expect(supportsSeedHunt(w.id)).toBe(true)
    expect(supportsSeedHunt('some-future-model')).toBe(false)
    expect(supportsSeedHunt(undefined)).toBe(false)
  })
})
