import { describe, it, expect } from 'vitest'
import {
  toDirectorInputs,
  totalFrames,
  emptyTimeline,
  parseTimeline,
  visionShots,
  VISION_SHOT_LIMIT,
  type DirectorShot,
  type DirectorTimeline,
} from './director-timeline'

const seg = (id: string, startSec: number, lengthSec: number, prompt: string): DirectorShot =>
  ({ id, startSec, lengthSec, prompt })

const base: DirectorTimeline = {
  durationSeconds: 3,
  fps: 30,
  globalPrompt: 'cinematic daylight',
  segments: [seg('a', 0, 1.5, 'a red car'), seg('b', 1.5, 1.5, 'the car turns')],
  audio: [],
  motion: [],
}

const parse = (t: DirectorTimeline) => JSON.parse(toDirectorInputs(t).timeline_data)
const lengths = (t: DirectorTimeline) =>
  toDirectorInputs(t).segment_lengths.split(',').filter(Boolean).map(Number)

describe('totalFrames', () => {
  it('is duration*fps plus the LTX trailing frame', () => {
    expect(totalFrames({ durationSeconds: 3, fps: 30 })).toBe(91)
    expect(totalFrames({ durationSeconds: 15, fps: 30 })).toBe(451)
  })
})

describe('toDirectorInputs — prompt relay', () => {
  it('joins prompts with | in start order', () => {
    const out = toDirectorInputs({
      ...base,
      segments: [seg('b', 1.5, 1.5, 'second'), seg('a', 0, 1.5, 'first')],
    })
    expect(out.local_prompts).toBe('first|second')
  })

  // The node raises outright when these two disagree, so this is the one
  // invariant the serializer exists to guarantee.
  it('emits exactly one length per prompt', () => {
    for (const n of [1, 2, 3, 7, 20]) {
      const step = base.durationSeconds / n
      const segments = Array.from({ length: n }, (_, i) => seg(`s${i}`, i * step, step, `p${i}`))
      const out = toDirectorInputs({ ...base, segments })
      expect(out.local_prompts.split('|')).toHaveLength(n)
      expect(out.segment_lengths.split(',')).toHaveLength(n)
    }
  })

  it('lengths always sum to exactly the frame count', () => {
    for (const n of [1, 2, 3, 5, 7, 11, 13]) {
      const step = 3 / n
      const segments = Array.from({ length: n }, (_, i) => seg(`s${i}`, i * step, step, `p${i}`))
      const t = { ...base, segments }
      expect(lengths(t).reduce((a, b) => a + b, 0)).toBe(totalFrames(t))
    }
  })

  it('never emits a zero-length window', () => {
    // Three shots crammed into a tenth of a second at 30 fps.
    const t = {
      ...base,
      segments: [seg('a', 0, 0.1, 'x'), seg('b', 0.1, 0.1, 'y'), seg('c', 0.2, 0.1, 'z')],
    }
    expect(lengths(t).every((l) => l >= 1)).toBe(true)
    expect(lengths(t).reduce((a, b) => a + b, 0)).toBe(totalFrames(t))
  })

  // Only reachable from a hand-edited file — the editor's own minimum is six
  // frames — but a zero-length window would desync prompts from lengths, which
  // the node rejects outright.
  it('drops a shot too short to round to a single frame', () => {
    const out = toDirectorInputs({
      ...base,
      segments: [seg('a', 0, 0.001, 'gone'), seg('b', 1, 1, 'kept')],
    })
    expect(out.local_prompts).toBe('kept')
    expect(out.segment_lengths).toBe('91')
  })

  // Gaps are what let a shot be placed anywhere without the director having to
  // tile the whole clip by hand. The node has no notion of one, so they are
  // absorbed exactly as upstream's widget does it.
  it('absorbs a leading gap into the first window', () => {
    const t = { ...base, segments: [seg('a', 0.9, 0.6, 'x'), seg('b', 1.5, 1.5, 'y')] }
    expect(lengths(t)[0]).toBe(45) // opens at frame 0, not at 0.9 s
    expect(lengths(t).reduce((a, b) => a + b, 0)).toBe(totalFrames(t))
  })

  it('absorbs a middle gap into the window before it', () => {
    const t = { ...base, segments: [seg('a', 0, 1, 'x'), seg('b', 2, 1, 'y')] }
    expect(lengths(t)).toEqual([60, 31]) // a runs on through the gap
  })

  it('absorbs a trailing gap into the last window', () => {
    const t = { ...base, segments: [seg('a', 0, 1, 'x')] }
    expect(lengths(t)).toEqual([91])
  })

  it('an empty track takes the node fast path rather than emitting nothing usable', () => {
    const out = toDirectorInputs({ ...base, segments: [] })
    expect(out.local_prompts).toBe('')
    expect(out.segment_lengths).toBe('')
  })

  it('a single shot still produces one matching pair', () => {
    const out = toDirectorInputs({ ...base, segments: [seg('a', 0, 3, 'only')] })
    expect(out.local_prompts).toBe('only')
    expect(out.segment_lengths).toBe('91')
  })

  it('resolves an overlap in favour of whoever got there first', () => {
    const t = { ...base, segments: [seg('a', 0, 2, 'x'), seg('b', 1, 2, 'y')] }
    expect(lengths(t)).toEqual([60, 31])
    expect(lengths(t).reduce((a, b) => a + b, 0)).toBe(totalFrames(t))
  })
})

// The pictures and the prompts come off the SAME blocks — that is upstream's
// model, and the reason a shot can be "a prompt with an image in it".
describe('toDirectorInputs — pictures', () => {
  const withPic = (id: string, startSec: number, strength = 1): DirectorShot => ({
    ...seg(id, startSec, 1, ''),
    file: `${id}.png`,
    strength,
  })

  it('converts seconds to frames and pairs strengths in start order', () => {
    const out = toDirectorInputs({
      ...base,
      segments: [withPic('late', 2, 0.5), withPic('early', 0, 0.9)],
    })
    const d = JSON.parse(out.timeline_data)
    expect(d.segments.map((s: { imageFile: string }) => s.imageFile)).toEqual([
      'early.png',
      'late.png',
    ])
    expect(d.segments.map((s: { start: number }) => s.start)).toEqual([0, 60])
    // Strengths are indexed positionally against the node's own sorted list.
    expect(out.guide_strength).toBe('0.9,0.5')
  })

  it('leaves a text-only shot out of the guides but keeps its prompt', () => {
    const out = toDirectorInputs({
      ...base,
      segments: [seg('t', 0, 1.5, 'just words'), withPic('p', 1.5)],
    })
    expect(JSON.parse(out.timeline_data).segments).toHaveLength(1)
    expect(out.guide_strength).toBe('1')
    expect(out.local_prompts).toBe('just words|')
  })

  it('clamps a picture past the end so it cannot be dropped node-side', () => {
    // A dropped segment would silently shift every later strength by one.
    const d = parse({ ...base, segments: [withPic('end', 99)] })
    expect(d.segments[0].start).toBe(totalFrames(base) - 1)
  })

  it('marks a still as type image, spanning its block', () => {
    const d = parse({ ...base, segments: [withPic('k', 1)] })
    expect(d.segments[0]).toMatchObject({ type: 'image', length: 30 })
    expect(d.segments[0].isEndFrame).toBeUndefined()
    expect(d.segments[0].trimStart).toBeUndefined()
  })

  it('never lets a span overrun the render', () => {
    // 2.5 s into a 3 s clip: 91 - 75 = 16 frames left, not the 60 asked for.
    const d = parse({ ...base, segments: [{ ...withPic('k', 2.5), lengthSec: 2 }] })
    expect(d.segments[0].length).toBe(16)
  })

  it('carries isEndFrame when set', () => {
    const d = parse({ ...base, segments: [{ ...withPic('k', 1), isEndFrame: true }] })
    expect(d.segments[0].isEndFrame).toBe(true)
  })

  it('emits a clip as type video with its trim', () => {
    const d = parse({
      ...base,
      segments: [{
        ...withPic('v', 1), file: 'clip.mp4', kind: 'video' as const,
        lengthSec: 1.5, trimStartSec: 0.5, sourceDurationSec: 8,
      }],
    })
    expect(d.segments[0]).toEqual({
      type: 'video', imageFile: 'clip.mp4', start: 30, length: 45, trimStart: 15,
    })
  })

  it('defaults an unset strength to 1 rather than an empty slot', () => {
    const noStrength: DirectorShot = { ...seg('k', 0, 1, ''), file: 'k.png' }
    expect(toDirectorInputs({ ...base, segments: [noStrength] }).guide_strength).toBe('1')
  })
})

describe('toDirectorInputs — media lanes', () => {
  const media = { id: 'm', startSec: 1, lengthSec: 1.5, trimStartSec: 0.5, file: 'x.wav' }

  it('writes audio under audioFile and motion under videoFile', () => {
    const d = parse({
      ...base,
      audio: [media],
      motion: [{ ...media, id: 'v', file: 'y.mp4' }],
    })
    expect(d.audioSegments[0]).toEqual({ audioFile: 'x.wav', start: 30, length: 45, trimStart: 15 })
    expect(d.motionSegments[0]).toEqual({ videoFile: 'y.mp4', start: 30, length: 45, trimStart: 15 })
  })

  it('keeps lanes present but empty by default', () => {
    const d = parse(base)
    expect(d.audioSegments).toEqual([])
    expect(d.motionSegments).toEqual([])
    expect(d.retakeMode).toBeUndefined()
  })
})

// Off means "ignore this", not "delete it" — the contents must survive so the
// switch can be flipped back.
describe('toDirectorInputs — switches', () => {
  const full: DirectorTimeline = {
    ...base,
    segments: [{ ...seg('a', 0, 1.5, 'a red car'), file: 'k.png', strength: 1 }, seg('b', 1.5, 1.5, 'the car turns')],
    audio: [{ id: 'a', startSec: 0, lengthSec: 1, trimStartSec: 0, file: 'a.wav' }],
    motion: [{ id: 'm', startSec: 0, lengthSec: 1, trimStartSec: 0, file: 'm.mp4' }],
  }

  it('everything is on when the switches are absent (old saved timelines)', () => {
    const d = parse(full)
    expect(d.segments).toHaveLength(1)
    expect(d.audioSegments).toHaveLength(1)
    expect(d.motionSegments).toHaveLength(1)
    expect(toDirectorInputs(full).local_prompts).toBe('a red car|the car turns')
  })

  // Relay off must hit the node's documented single-prompt fast path, which it
  // takes when local_prompts has fewer than two entries.
  it('prompt relay off collapses to the global prompt alone', () => {
    const out = toDirectorInputs({ ...full, promptRelay: false })
    expect(out.local_prompts).toBe('')
    expect(out.segment_lengths).toBe('')
    expect(JSON.parse(out.timeline_data).global_prompt).toBe('cinematic daylight')
  })

  // Prompt and picture share a block now, so this pair has to stay independent
  // or "render it again without the images" would take the prompts with it.
  it('dropping the pictures keeps the prompts, and the other way round', () => {
    const noPics = toDirectorInputs({ ...full, keyframesOn: false })
    expect(JSON.parse(noPics.timeline_data).segments).toEqual([])
    expect(noPics.guide_strength).toBe('')
    expect(noPics.local_prompts).toBe('a red car|the car turns')

    const noPrompts = toDirectorInputs({ ...full, promptRelay: false })
    expect(JSON.parse(noPrompts.timeline_data).segments).toHaveLength(1)
  })

  it('each media switch drops only its own lane', () => {
    expect(parse({ ...full, audioOn: false }).audioSegments).toEqual([])
    expect(parse({ ...full, motionOn: false }).motionSegments).toEqual([])
    const d = parse({ ...full, audioOn: false })
    expect(d.segments).toHaveLength(1)
    expect(d.motionSegments).toHaveLength(1)
  })

  it('switching a lane off does not discard its contents', () => {
    const off = { ...full, audioOn: false as const }
    expect(off.audio).toHaveLength(1)
    expect(parse({ ...off, audioOn: true }).audioSegments).toHaveLength(1)
  })
})

describe('toDirectorInputs — retake', () => {
  it('emits the retake block only when set', () => {
    const d = parse({
      ...base,
      retake: { videoFile: 'prev.mp4', startSec: 1, lengthSec: 1, videoDurationSec: 3 },
    })
    expect(d.retakeMode).toBe(true)
    expect(d.retakeVideo).toEqual({ imageFile: 'prev.mp4', videoDurationFrames: 90 })
    expect(d.retakeStart).toBe(30)
    expect(d.retakeLength).toBe(30)
  })

  // The node reads retake_global_prompt INSTEAD of global_prompt while retake is
  // on, so an empty one would blank the prompt rather than inherit it.
  it('uses the retake prompt when set, else falls back to the global one', () => {
    const r = { videoFile: 'p.mp4', startSec: 1, lengthSec: 1, videoDurationSec: 3 }
    expect(parse({ ...base, retake: r }).retake_global_prompt).toBe('cinematic daylight')
    expect(parse({ ...base, retake: { ...r, prompt: '  ' } }).retake_global_prompt).toBe(
      'cinematic daylight',
    )
    expect(parse({ ...base, retake: { ...r, prompt: 'now at night' } }).retake_global_prompt).toBe(
      'now at night',
    )
  })
})

// Loaded from a user-supplied file, so this is a trust boundary: a missing lane
// crashes a .map() deep in render, a wrong shape reaches the node as garbage.
describe('parseTimeline', () => {
  const fb = { durationSeconds: 15, fps: 30 }
  const ok = { ...base, retake: undefined }

  it('round-trips a saved timeline', () => {
    const out = parseTimeline(JSON.parse(JSON.stringify(ok)), fb)
    expect(out?.segments.map((s) => s.prompt)).toEqual(['a red car', 'the car turns'])
    expect(out?.segments.map((s) => s.lengthSec)).toEqual([1.5, 1.5])
    expect(out?.globalPrompt).toBe('cinematic daylight')
  })

  it('rejects anything that is not a timeline', () => {
    for (const bad of [null, 42, 'x', [], {}, { segments: 'nope' }]) {
      expect(parseTimeline(bad, fb)).toBeNull()
    }
  })

  it('accepts an empty track — that is a valid timeline, not a broken one', () => {
    expect(parseTimeline({ segments: [] }, fb)).toMatchObject({ segments: [] })
  })

  it('rejects segments without ids rather than rendering keyless rows', () => {
    expect(parseTimeline({ segments: [{ startSec: 0, prompt: 'x' }] }, fb)).toBeNull()
  })

  it('fills missing lanes so render cannot crash on them', () => {
    const out = parseTimeline({ segments: [{ id: 'a', startSec: 0, lengthSec: 1, prompt: 'x' }] }, fb)
    expect(out).toMatchObject({ audio: [], motion: [], durationSeconds: 15, fps: 30 })
  })

  it('falls back on non-positive or garbage duration/fps', () => {
    for (const v of [0, -5, 'abc', null]) {
      expect(parseTimeline({ ...ok, durationSeconds: v, fps: v }, fb)).toMatchObject(fb)
    }
  })

  // Timelines saved before prompts and pictures shared a block: shot boundaries
  // become lengths, and every keyframe becomes a block carrying its picture.
  it('folds a two-lane timeline from before the merge', () => {
    const old = {
      durationSeconds: 10,
      fps: 30,
      globalPrompt: 'g',
      segments: [{ id: 's1', startSec: 0, prompt: 'one' }, { id: 's2', startSec: 4, prompt: 'two' }],
      keyframes: [{ id: 'k1', atSec: 6, imageFile: 'a.png', strength: 0.5, width: 100, height: 50 }],
      audio: [],
      motion: [],
    }
    const out = parseTimeline(old, fb)!
    expect(out.segments).toHaveLength(3)
    expect(out.segments[0]).toMatchObject({ startSec: 0, lengthSec: 4, prompt: 'one' })
    expect(out.segments[1]).toMatchObject({ startSec: 4, lengthSec: 6, prompt: 'two' })
    expect(out.segments[2]).toMatchObject({
      startSec: 6, file: 'a.png', strength: 0.5, width: 100, height: 50, prompt: '',
    })
    expect('keyframes' in out).toBe(false)
  })

  it('produces something the serializer accepts', () => {
    const out = parseTimeline(JSON.parse(JSON.stringify(ok)), fb)!
    const s = toDirectorInputs(out)
    expect(s.local_prompts.split('|')).toHaveLength(s.segment_lengths.split(',').length)
  })
})

describe('emptyTimeline', () => {
  // No blocks at all: the whole clip on the global prompt, which is the node's
  // own fast path. One full-length block would mean the first thing anyone does
  // is shrink it before they can add a second.
  it('starts empty and serialises to the fast path', () => {
    const out = toDirectorInputs(emptyTimeline())
    expect(emptyTimeline().segments).toEqual([])
    expect(out.local_prompts).toBe('')
    expect(out.segment_lengths).toBe('')
  })
})

describe('visionShots', () => {
  const pic = (id: string, startSec: number, file?: string): DirectorShot =>
    ({ id, startSec, lengthSec: 1, prompt: '', ...(file ? { file } : {}) })

  it('takes the pictures in play order, whatever order they were added', () => {
    const t = {
      ...base,
      segments: [pic('c', 4, 'c.png'), pic('a', 0, 'a.png'), pic('b', 2, 'b.png')],
    }
    expect(visionShots(t).map((s) => s.file)).toEqual(['a.png', 'b.png', 'c.png'])
  })

  it('skips text-only blocks — they have nothing to look at', () => {
    const t = { ...base, segments: [pic('a', 0), pic('b', 1, 'b.png'), pic('c', 2)] }
    expect(visionShots(t).map((s) => s.file)).toEqual(['b.png'])
  })

  // A long timeline must not turn one enhance into a dozen vision passes.
  it('caps at the limit, keeping the opening of the film', () => {
    const t = {
      ...base,
      segments: Array.from({ length: 12 }, (_, i) => pic(`s${i}`, i, `${i}.png`)),
    }
    const out = visionShots(t)
    expect(out).toHaveLength(VISION_SHOT_LIMIT)
    expect(out[0].file).toBe('0.png')
    expect(out.at(-1)!.file).toBe(`${VISION_SHOT_LIMIT - 1}.png`)
  })

  it('has nothing to send for an empty timeline', () => {
    expect(visionShots(emptyTimeline())).toEqual([])
  })
})
