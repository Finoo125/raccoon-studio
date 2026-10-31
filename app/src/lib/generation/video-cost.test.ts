import { describe, it, expect } from 'vitest'
import { h3EditPlan } from '@/lib/workflows/minimax-h3'
import type { GenerationJob } from '@/lib/comfyui/queue'
import type { VideoGenerationParams } from '@/types/video-workflow'
import { estimateSeconds, huntMultiplier, renderUnits, secondsPerUnit } from './video-cost'

const h3 = (over: Partial<VideoGenerationParams> = {}): VideoGenerationParams => ({
  prompt: 'x',
  mode: 'i2v',
  videoModel: 'minimax-h3',
  orientation: 'portrait',
  durationSeconds: 6,
  fps: 24,
  seed: -1,
  vramMode: 'high',
  ...over,
})

/** A finished render of `params` that took `seconds`. */
const done = (params: VideoGenerationParams, seconds: number, id = 'minimax-h3'): GenerationJob =>
  ({
    id: 'j',
    promptId: 'p',
    workflowId: id,
    workflowName: 'w',
    prompt: 'x',
    kind: 'video',
    generationParams: params,
    status: 'done',
    progress: 1,
    maxProgress: 1,
    currentNode: null,
    outputImages: [],
    createdAt: 0,
    startedAt: 0,
    endedAt: seconds * 1000,
  }) as GenerationJob

describe('renderUnits', () => {
  it('rises with steps, frames and pixels', () => {
    const base = renderUnits('minimax-h3', h3())
    expect(renderUnits('minimax-h3', h3({ durationSeconds: 12 }))).toBeGreaterThan(base)
    expect(renderUnits('minimax-h3', h3({ vramMode: 'low' }))).toBeLessThan(base)
    // Fast is 8 steps against the stock 20, so it must cost less.
    expect(renderUnits('minimax-h3', h3({ turbo: 'fast' }))).toBeLessThan(base)
  })

  it('reads the legacy `turbo: true` as Draft rather than as truthiness', () => {
    expect(renderUnits('minimax-h3', h3({ turbo: true }))).toBe(
      renderUnits('minimax-h3', h3({ turbo: 'draft' })),
    )
  })

  it('ignores the Speed row on Eros, whose distillation is in the weights', () => {
    const eros = h3({ h3Checkpoint: 'eros' })
    expect(renderUnits('minimax-h3', { ...eros, turbo: 'fast' })).toBe(
      renderUnits('minimax-h3', eros),
    )
  })
})

describe('huntMultiplier', () => {
  it('is 1 when the hunt is off', () => {
    expect(huntMultiplier('minimax-h3', h3(), 0)).toBe(1)
  })

  it('matches the shares the panel quotes', () => {
    expect(huntMultiplier('minimax-h3', h3(), 3)).toBeCloseTo(3 * 0.42 + 1)
    expect(huntMultiplier('ltx23', h3(), 3)).toBeCloseTo(3 * 0.65 + 1)
    expect(huntMultiplier('minimax-h3', h3({ h3Checkpoint: 'eros' }), 3)).toBeCloseTo(3 * 0.84 + 1)
  })
  it('hunts SparseRef15 at its own share (6 of 8 steps)', () => {
    expect(huntMultiplier('minimax-h3', h3({ h3Checkpoint: 'sparseref' }), 2)).toBeCloseTo(2 * 0.75 + 1)
  })
})

describe('secondsPerUnit', () => {
  it('is null with nothing to learn from', () => {
    expect(secondsPerUnit('minimax-h3', [])).toBeNull()
  })

  it('ignores other workflows, unfinished jobs and seed-hunt candidates', () => {
    const p = h3()
    const jobs = [
      done(p, 100, 'ltx23'),
      { ...done(p, 100), status: 'running' as const },
      done({ ...p, seedHunt: true }, 10),
    ]
    expect(secondsPerUnit('minimax-h3', jobs)).toBeNull()
  })

  it('takes the median, so one cold model load cannot skew every later estimate', () => {
    const p = h3()
    const units = renderUnits('minimax-h3', p)
    const jobs = [done(p, 100), done(p, 110), done(p, 400)]
    expect(secondsPerUnit('minimax-h3', jobs)).toBeCloseTo(110 / units)
  })
})

describe('estimateSeconds', () => {
  it('is null until this machine has finished one render', () => {
    expect(estimateSeconds('minimax-h3', h3(), 0, [])).toBeNull()
  })

  it('scales a past render to the settings now on the form', () => {
    // One 6 s Full-quality render took 200 s. Halving the steps (Fast is 8 of
    // 20) should roughly halve the estimate.
    const history = [done(h3(), 200)]
    const full = estimateSeconds('minimax-h3', h3(), 0, history)!
    const fast = estimateSeconds('minimax-h3', h3({ turbo: 'fast' }), 0, history)!
    expect(full).toBeCloseTo(200)
    expect(fast).toBeCloseTo(200 * (8 / 20))
  })

  it('counts the whole seed hunt, not one candidate', () => {
    const history = [done(h3(), 200)]
    expect(estimateSeconds('minimax-h3', h3(), 3, history)!).toBeCloseTo(200 * (3 * 0.42 + 1))
  })
})

describe('renderUnits — H3 edit', () => {
  const edit = (frames: number, over: Partial<VideoGenerationParams> = {}) => ({
    prompt: 'x', mode: 'edit', durationSeconds: 5, fps: 24, seed: 1, vramMode: 'low',
    h3Checkpoint: 'eros', editSource: 'a.mp4', editSourceWidth: 864, editSourceHeight: 480, editSourceFrames: frames,
    ...over,
  }) as VideoGenerationParams
  it("costs the clip's own length, twice over for the anchored guide, not the hidden slider", () => {
    const t2v = renderUnits('minimax-h3', { ...edit(124), mode: 't2v' })
    expect(renderUnits('minimax-h3', edit(124))).toBeCloseTo(2 * t2v, 6)
  })
  it('costs every part a split edit renders, overlap included', () => {
    const frames = (p: VideoGenerationParams) => h3EditPlan(p)!.reduce((s, c) => s + c.frames, 0)
    const p = edit(362, { vramMode: 'medium', editSourceWidth: 608, editSourceHeight: 1056 })
    expect(h3EditPlan(p)!.length).toBeGreaterThan(1)
    const one = edit(124, { vramMode: 'medium', editSourceWidth: 608, editSourceHeight: 1056 })
    expect(renderUnits('minimax-h3', p) / renderUnits('minimax-h3', one)).toBeCloseTo(frames(p) / 124, 6)
    // Seamless re-renders 39 frames per extra part, so it costs more than Fast.
    expect(renderUnits('minimax-h3', p)).toBeGreaterThan(renderUnits('minimax-h3', { ...p, editJoin: 'fast' }))
  })
  it('costs a loose edit at 1.25x its frames instead of 2x', () => {
    const exact = edit(124)
    expect(renderUnits('minimax-h3', { ...exact, editFollow: 'loose' }) / renderUnits('minimax-h3', exact)).toBeCloseTo(1.25 / 2, 6)
  })
})

describe('renderUnits — Hybrid checkpoint', () => {
  it('costs its own 13 steps, whatever the Speed row says', () => {
    const base = { prompt: 'x', mode: 't2v', durationSeconds: 5, fps: 24, seed: 1, vramMode: 'low' } as VideoGenerationParams
    const full = renderUnits('minimax-h3', { ...base, h3Checkpoint: 'base' })   // 20 steps
    expect(renderUnits('minimax-h3', { ...base, h3Checkpoint: 'hybrid', turbo: 'fast' }) / full).toBeCloseTo(13 / 20, 6)
  })
})
