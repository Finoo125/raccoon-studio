import { describe, it, expect } from 'vitest'
import { buildEnhanceArgs, type EnhanceArgsInput } from './enhance-args'
import type { EnhanceSettingsValues } from '@/components/generation/EnhanceSettings'
import type { VideoGenerationParams } from '@/types/video-workflow'

const SETTINGS: EnhanceSettingsValues = {
  model: 'gemma:26b',
  environment: 'None',
  scenario: 'None',
  camera: 'None',
  music: '',
  pov: false,
  povGender: 'female',
  dialogueTier: 'standard',
  energy: 5,
  userIntent: 'she walks the corridor',
}

const PARAMS: VideoGenerationParams = {
  mode: 't2v',
  prompt: '',
  durationSeconds: 15,
  fps: 30,
  seed: -1,
}

type Over = Omit<Partial<EnhanceArgsInput>, 'params'> & { params?: Partial<VideoGenerationParams> }

const args = (over: Over = {}) =>
  buildEnhanceArgs({
    settings: SETTINGS,
    workflowId: 'ltx23',
    imageB64: 'SEED-IMAGE',
    ...over,
    params: { ...PARAMS, ...over.params },
  })

describe('buildEnhanceArgs — what the vision pass is shown', () => {
  it('sends the one source image in i2v', () => {
    expect(args({ params: { mode: 'i2v' } }).imageB64).toBe('SEED-IMAGE')
  })

  // `imageB64` survives a mode switch, so before this the i2v seed rode along
  // into a t2v enhance and started a vision pass on a picture the user had
  // moved away from.
  it('sends nothing in t2v, even with a seed image left over from i2v', () => {
    expect(args({ params: { mode: 't2v' }, imageB64: 'STALE' }).imageB64).toBe('')
  })

  it('sends every shot picture in director mode, in the order given', () => {
    const out = args({ params: { mode: 'director' }, directorImages: ['a', 'b', 'c'] })
    expect(out.imageB64).toEqual(['a', 'b', 'c'])
  })

  it('ignores the single-image slot in director mode', () => {
    const out = args({ params: { mode: 'director' }, imageB64: 'STALE', directorImages: ['a'] })
    expect(out.imageB64).toEqual(['a'])
  })

  // A timeline with no pictures is not an error — the node writes blind.
  it('sends an empty list for a director timeline with no pictures', () => {
    expect(args({ params: { mode: 'director' } }).imageB64).toEqual([])
  })

  it('sends the first reference in ref2v', () => {
    expect(args({ params: { mode: 'ref2v' } }).imageB64).toBe('SEED-IMAGE')
  })
})

describe('buildEnhanceArgs — reference counts', () => {
  const refs: Partial<VideoGenerationParams> = {
    mode: 'ref2v',
    refImages: ['a.png', undefined, 'b.png'],
    refVideos: [undefined, 'c.mp4'],
    refAudios: [],
  }

  // Empty slots are gaps in the UI, not references: the doctrine names one tag
  // per attached reference, and counting a gap makes it name one H3 never gets.
  it('counts filled slots only, ignoring the gaps between them', () => {
    expect(args({ params: refs }).refCounts).toEqual({ images: 2, videos: 1, audios: 0 })
  })

  it('counts nothing when no slot is filled', () => {
    expect(args({ params: { mode: 'ref2v' } }).refCounts).toEqual({ images: 0, videos: 0, audios: 0 })
  })

  it.each(['t2v', 'i2v', 'director'] as const)(
    'leaves the counts undefined in %s, so no reference type is named',
    (mode) => {
      expect(args({ params: { ...refs, mode } }).refCounts).toBeUndefined()
    },
  )
})

describe('buildEnhanceArgs — which doctrine the node picks', () => {
  // Director is a mode of the LTX graph, not a model of its own: it enhances
  // against the LTX brain, so it must report the LTX id.
  it.each(['ltx23', 'ltx23-director'])('reports %s as the LTX brain', (workflowId) => {
    expect(args({ workflowId }).videoModel).toBe('ltx23')
  })

  it('reports H3 under its own id, which selects the H3 doctrine', () => {
    expect(args({ workflowId: 'minimax-h3' }).videoModel).toBe('minimax-h3')
  })

  // It used to be rewritten to 't2v', which asks the node for a brief that
  // swears there is no reference image while the shots sit on the timeline.
  it.each(['t2v', 'i2v', 'ref2v', 'director'] as const)('passes %s through as the video mode', (mode) => {
    expect(args({ params: { mode } }).videoMode).toBe(mode)
  })
})

describe('buildEnhanceArgs — the rest is passed through', () => {
  it('carries the enhance settings and the clip length verbatim', () => {
    const out = args({
      settings: { ...SETTINGS, pov: true, energy: 9, dialogueTier: 'talkative' },
      params: { durationSeconds: 8 },
    })
    expect(out).toMatchObject({
      model: 'gemma:26b',
      environment: 'None',
      scenario: 'None',
      camera: 'None',
      music: '',
      pov: true,
      povGender: 'female',
      dialogueTier: 'talkative',
      energy: 9,
      userIntent: 'she walks the corridor',
      durationS: 8,
    })
  })
})
