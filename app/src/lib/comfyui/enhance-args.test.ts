import { describe, it, expect } from 'vitest'
import { buildEnhanceArgs, writeBlockReason, type EnhanceArgsInput } from './enhance-args'
import type { EnhanceSettingsValues } from './enhance-settings'
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

describe('buildEnhanceArgs — one continuous shot', () => {
  // Absent means "the duration table decides", which is what every saved job
  // and every older client sends; it must not read as "one shot".
  it('is false unless the form asked for it', () => {
    expect(args().singleShot).toBe(false)
    expect(args({ params: { singleShot: false } }).singleShot).toBe(false)
  })

  it('passes the request through for the doctrine to act on', () => {
    expect(args({ params: { singleShot: true } }).singleShot).toBe(true)
  })
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
    expect(args({ params: refs }).refCounts).toEqual({
      images: 2, videos: 1, audios: 0, image_roles: [null, null],
    })
  })

  it('counts nothing when no slot is filled', () => {
    expect(args({ params: { mode: 'ref2v' } }).refCounts).toEqual({
      images: 0, videos: 0, audios: 0, image_roles: [],
    })
  })

  // The roles have to compact against the SAME gaps the images do, or role N
  // describes a different picture than <Picture N>: clearing the first slot
  // promotes the second to <Picture 1>, and an independently compacted role
  // list would hand it the cleared slot's job.
  it('lines each role up with the picture it describes', () => {
    expect(
      args({
        params: {
          mode: 'ref2v',
          refImages: ['a.png', undefined, 'b.png'],
          refImageRoles: ['character', 'location', 'style'],
        },
      }).refCounts?.image_roles,
    ).toEqual(['character', 'style'])
  })

  // Unset is the default and must stay expressible: node-side an absent role
  // reproduces the doctrine exactly as it shipped before roles existed. Roled
  // pictures are presented first (see `orderedRefImages`), so the unset one
  // becomes <Picture 2> here — in the prompt AND at the node.
  it('sends null for a picture with no role set', () => {
    expect(
      args({ params: { mode: 'ref2v', refImages: ['a.png', 'b.png'], refImageRoles: [undefined, 'prop'] } })
        .refCounts?.image_roles,
    ).toEqual(['prop', null])
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

  // On H3 the mode the user picked is not the task that runs: filling the end
  // frame slot turns i2v into fl2v or l2v, and each has its own mandatory
  // alignment line in MiniMax's guide. Sending plain 'i2v' would produce a
  // prompt anchored to a first frame the render does not have.
  const h3 = (params: Partial<VideoGenerationParams>) =>
    args({ workflowId: 'minimax-h3', params: { mode: 'i2v', ...params } })

  it('derives the H3 keyframe task from the filled slots', () => {
    expect(h3({ inputImage: 's.png' }).videoMode).toBe('i2v')
    expect(h3({ inputImage: 's.png', endImage: 'e.png' }).videoMode).toBe('fl2v')
    expect(h3({ endImage: 'e.png' }).videoMode).toBe('l2v')
  })

  it('leaves LTX on the mode it was given — it has no last-frame input', () => {
    expect(args({ workflowId: 'ltx23', params: { mode: 'i2v', endImage: 'e.png' } }).videoMode)
      .toBe('i2v')
  })
})

describe('buildEnhanceArgs — what the vision pass sees for a keyframe task', () => {
  const h3 = (params: Partial<VideoGenerationParams>) =>
    buildEnhanceArgs({
      settings: SETTINGS,
      workflowId: 'minimax-h3',
      imageB64: 'START-B64',
      endImageB64: 'END-B64',
      params: { ...PARAMS, mode: 'i2v', ...params },
    })

  it('shows fl2v both frames, start first — the doctrine numbers them in that order', () => {
    expect(h3({ inputImage: 's.png', endImage: 'e.png' }).imageB64)
      .toEqual(['START-B64', 'END-B64'])
  })

  it('shows l2v only the end frame, which is the only image that exists', () => {
    expect(h3({ endImage: 'e.png' }).imageB64).toBe('END-B64')
  })

  it('still shows plain i2v its single source image', () => {
    expect(h3({ inputImage: 's.png' }).imageB64).toBe('START-B64')
  })

  it('drops an empty half rather than sending a blank image', () => {
    // The end frame can be set in params a tick before its base64 lands.
    expect(buildEnhanceArgs({
      settings: SETTINGS, workflowId: 'minimax-h3', imageB64: 'START-B64',
      params: { ...PARAMS, mode: 'i2v', inputImage: 's.png', endImage: 'e.png' },
    }).imageB64).toEqual(['START-B64'])
  })
})

describe('buildEnhanceArgs — continuing a clip', () => {
  // Continue merges over whatever the form holds, so the params carry another
  // project's start frame, references and roles. None of it renders.
  const cont = (over: Over = {}) =>
    buildEnhanceArgs({
      settings: SETTINGS,
      workflowId: 'minimax-h3',
      imageB64: 'STALE-START',
      continueFrameB64: 'TAIL-B64',
      ...over,
      params: {
        ...PARAMS,
        mode: 't2v',
        continueFrom: 'video/MinimaxH3/2026-09-13/230559-MinimaxH3__00001_.mp4',
        refImages: ['a.png', 'b.png'],
        refImageRoles: ['character', 'outfit'],
        ...over.params,
      },
    })

  // The writer used to be told t2v with no picture and no word about the
  // previous clip, so it invented the look — grey sports bra, hair in a bun,
  // studio light — and H3 obeyed it six frames after the pinned head ended.
  it('writes for the continuation task and is shown the previous clip’s last frame', () => {
    expect(cont()).toMatchObject({ videoMode: 'continue', imageB64: 'TAIL-B64' })
  })

  it('never lets the stale start-frame slot stand in for the tail', () => {
    expect(cont({ continueFrameB64: '' }).imageB64).toBe('')
  })

  // Reference slots left over from another project do not render in a
  // continuation, so the doctrine must not be told about them either.
  it('names no references', () => {
    expect(cont().refCounts).toBeUndefined()
  })

  it('leaves LTX on its own mode — its builder ignores continueFrom', () => {
    expect(args({ params: { continueFrom: 'video/a.mp4' }, continueFrameB64: 'TAIL-B64' }))
      .toMatchObject({ videoMode: 't2v', imageB64: '' })
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

describe('buildEnhanceArgs — H3 keyframes and reference continuations', () => {
  const H3 = 'minimax-h3'
  const kf = { start: { image: 'a.png' }, middle: { image: 'b.png' }, end: { image: 'c.png' } }
  const shots = [{ slot: 'start', b64: 'A' }, { slot: 'middle', b64: 'B' }, { slot: 'end', b64: 'C' }] as const
  const ref = { mode: 'ref2v' as const, refImages: ['me.png'], refImageRoles: ['character'], keyframes: kf }

  it('shows the keyframes in time order with their times, and asks for one shot', () => {
    const a = args({ workflowId: H3, params: ref, keyframeImages: [...shots].reverse() })
    expect(a.imageB64).toEqual(['A', 'B', 'C'])
    expect(a.refCounts?.keyframes).toEqual([{ slot: 'start', at_s: 0 }, { slot: 'middle', at_s: 7.54 }, { slot: 'end', at_s: 15.04 }])
    expect(a.singleShot).toBe(true)
  })

  it('drops a keyframe whose picture could not be read from BOTH lists', () => {
    const a = args({ workflowId: H3, params: ref, keyframeImages: [shots[0], shots[2]] })
    expect(a.imageB64).toEqual(['A', 'C'])
    expect(a.refCounts?.keyframes?.map((k) => k.slot)).toEqual(['start', 'end'])
  })

  it('shows a reference continuation the previous clip first, then the keyframes', () => {
    const a = args({
      workflowId: H3, continueFrameB64: 'TAIL',
      params: { ...ref, durationSeconds: 10, continueFrom: 'video/x/a.mp4' }, keyframeImages: [...shots],
    })
    expect(a.imageB64).toEqual(['TAIL', 'B', 'C'])
    expect(a.refCounts?.continuing).toBe(true)
    expect(a.refCounts?.keyframes).toEqual([{ slot: 'middle', at_s: 5.88 }, { slot: 'end', at_s: 10.08 }])
  })

  it('leaves a plain reference render exactly as before', () => {
    const a = args({ workflowId: H3, params: { mode: 'ref2v', refImages: ['me.png'] } })
    expect(a.imageB64).toBe('SEED-IMAGE')
    expect(a.refCounts).not.toHaveProperty('keyframes')
    expect(a.refCounts).not.toHaveProperty('continuing')
    expect(a.singleShot).toBe(false)
  })

  it('ignores keyframes outside reference mode', () => {
    const a = args({ workflowId: H3, params: { mode: 'i2v', inputImage: 'x.png', keyframes: kf }, keyframeImages: [...shots] })
    expect(a.imageB64).toBe('SEED-IMAGE')
    expect(a.singleShot).toBe(false)
  })
})

describe('buildEnhanceArgs — keyframes whose pictures could not be read', () => {
  it('still asks for one shot: the render carries every guide even when the writer saw none', () => {
    const a = args({ workflowId: 'minimax-h3', params: { mode: 'ref2v', refImages: ['me.png'], keyframes: { end: { image: 'c.png' } } }, keyframeImages: [] })
    expect(a.singleShot).toBe(true)
  })
})

describe('writeBlockReason', () => {
  const S = SETTINGS
  const T2V = PARAMS
  it('names why a write cannot start', () => {
    expect(writeBlockReason({ ...T2V, mode: 't2v' }, { ...S, model: '' })).toBe('Pick a writer first.')
    expect(writeBlockReason({ ...T2V, mode: 't2v' }, { ...S, userIntent: ' ' })).toBe('Describe your idea above first.')
    expect(writeBlockReason({ ...T2V, mode: 'i2v', inputImage: undefined, endImage: undefined }, S)).toBe('Upload a start or end frame first.')
    expect(writeBlockReason({ ...T2V, mode: 'ref2v' }, S)).toBe('Add at least one reference first.')
    expect(writeBlockReason({ ...T2V, mode: 't2v' }, S)).toBeNull()
  })
  it('lets Make it better and Try again run without an idea, never without a writer or a frame', () => {
    const noIdea = { ...S, userIntent: ' ' }
    expect(writeBlockReason({ ...T2V, mode: 't2v' }, noIdea, { idea: false })).toBeNull()
    expect(writeBlockReason({ ...T2V, mode: 't2v' }, { ...noIdea, model: '' }, { idea: false })).toBe('Pick a writer first.')
    expect(writeBlockReason({ ...T2V, mode: 'i2v', inputImage: undefined, endImage: undefined }, noIdea, { idea: false }))
      .toBe('Upload a start or end frame first.')
  })
})
