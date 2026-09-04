import { describe, it, expect } from 'vitest'
import { buildConcatList, buildConcatArgs, assertJoinable, orderClipsForJoin, deriveChain, clipRefFromUrl, refToPath, type ClipShape } from './join'

const shape = (over: Partial<ClipShape> = {}): ClipShape => ({
  sampleRate: 32000,
  codec: 'h264',
  audioCodec: 'aac',
  width: 848,
  height: 480,
  ...over,
})

describe('buildConcatList', () => {
  it('writes Windows paths with forward slashes', () => {
    // ffmpeg's concat parser treats `\` as an escape, so a native Windows path
    // would swallow the newline and name a file that does not exist.
    const list = buildConcatList(['C:\\out\\video\\new.mp4'])
    expect(list).toBe("file 'C:/out/video/new.mp4'\n")
    expect(list).not.toContain('\\')
  })

  it('escapes a single quote in a path', () => {
    expect(buildConcatList(["/home/o'brien/a.mp4"])).toBe("file '/home/o'\\''brien/a.mp4'\n")
  })

  it('puts one entry per line and ends with a newline', () => {
    const list = buildConcatList(['/a.mp4', '/b.mp4', '/c.mp4'])
    expect(list.trimEnd().split('\n')).toHaveLength(3)
    expect(list.endsWith('\n')).toBe(true)
  })
})

describe('buildConcatArgs', () => {
  it('stream-copies rather than re-encoding', () => {
    // Every clip in a chain leaves the same graph at the same settings, so a
    // re-encode would spend a generation of quality on nothing.
    const args = buildConcatArgs('/tmp/list.txt', '/out/joined.mp4')
    expect(args).toContain('copy')
    expect(args.join(' ')).toContain('-c copy')
    expect(args.join(' ')).toContain('-f concat')
    // Absolute paths in the list are rejected without this.
    expect(args.join(' ')).toContain('-safe 0')
    expect(args[args.length - 1]).toBe('/out/joined.mp4')
  })
})

describe('assertJoinable', () => {
  it('accepts clips that came off the same graph', () => {
    expect(assertJoinable([shape(), shape(), shape()])).toBeNull()
  })

  it('refuses a mixed audio rate, naming the rates', () => {
    // The expensive one: a stream copy cannot change rate partway, so the tail
    // of the joined file plays as silence or noise while every duration check
    // still passes. H3 emits 32 kHz, not the 48 kHz most code assumes.
    const err = assertJoinable([shape(), shape({ sampleRate: 48000 })])
    expect(err).toMatch(/audio rate/)
    expect(err).toMatch(/48000/)
    expect(err).toMatch(/32000/)
  })

  it('refuses mismatched codecs and frame sizes', () => {
    expect(assertJoinable([shape(), shape({ codec: 'hevc' })])).toMatch(/video codec/)
    expect(assertJoinable([shape(), shape({ audioCodec: 'opus' })])).toMatch(/audio codec/)
    expect(assertJoinable([shape(), shape({ width: 640 })])).toMatch(/640x480/)
  })

  it('needs at least two clips', () => {
    expect(assertJoinable([shape()])).toMatch(/at least two/)
    expect(assertJoinable([])).toMatch(/at least two/)
  })

  it('names which clip is the odd one out, 1-based from the user’s view', () => {
    expect(assertJoinable([shape(), shape(), shape({ sampleRate: 44100 })])).toMatch(/clip 3/)
  })
})

describe('orderClipsForJoin', () => {
  const at = (createdAt: string, id: string) => ({ createdAt, id })

  it('plays oldest first, whatever order they were clicked in', () => {
    // The gallery hands back click order. Joining in that order produces a clip
    // that plays its middle first, and nothing in the pipeline complains.
    const picked = [at('2026-08-29T10:00:02Z', 'c'), at('2026-08-29T10:00:00Z', 'a'), at('2026-08-29T10:00:01Z', 'b')]
    expect(orderClipsForJoin(picked).map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the caller’s array', () => {
    const picked = [at('2026-08-29T10:00:02Z', 'c'), at('2026-08-29T10:00:00Z', 'a')]
    orderClipsForJoin(picked)
    expect(picked.map((c) => c.id)).toEqual(['c', 'a'])
  })

  it('keeps same-second clips in their existing order', () => {
    const picked = [at('2026-08-29T10:00:00Z', 'x'), at('2026-08-29T10:00:00Z', 'y')]
    expect(orderClipsForJoin(picked).map((c) => c.id)).toEqual(['x', 'y'])
  })
})

describe('deriveChain', () => {
  const j = (path: string, continueFrom?: string) => ({ path, continueFrom })

  it('walks back to the first clip, oldest first', () => {
    // Jobs arrive newest-first, the way the queue holds them.
    const chain = deriveChain([j('c.mp4', 'b.mp4'), j('b.mp4', 'a.mp4'), j('a.mp4')])
    expect(chain).toEqual(['a.mp4', 'b.mp4', 'c.mp4'])
  })

  it('leaves a rejected take out of the chain', () => {
    // Regenerating renders the link again from the SAME parent, so the discarded
    // attempt is not on the path back and never reaches the join.
    const chain = deriveChain([j('b2.mp4', 'a.mp4'), j('b1.mp4', 'a.mp4'), j('a.mp4')])
    expect(chain).toEqual(['a.mp4', 'b2.mp4'])
  })

  it('is just the clip itself when nothing was continued', () => {
    expect(deriveChain([j('a.mp4')])).toEqual(['a.mp4'])
    expect(deriveChain([])).toEqual([])
  })

  it('keeps the knowable part when the parent predates this session', () => {
    // Only the newest job is in history; its parent is still named, so the pair
    // is joinable even though the older job is gone.
    expect(deriveChain([j('b.mp4', 'a.mp4')])).toEqual(['a.mp4', 'b.mp4'])
  })

  it('does not spin on a self-referencing or looping parent', () => {
    expect(deriveChain([j('a.mp4', 'a.mp4')])).toEqual(['a.mp4'])
    expect(deriveChain([j('b.mp4', 'a.mp4'), j('a.mp4', 'b.mp4')])).toEqual(['a.mp4', 'b.mp4'])
  })
})

describe('clipRefFromUrl', () => {
  it('reads both url shapes the app produces', () => {
    expect(clipRefFromUrl('/api/comfyui/view?filename=x.mp4&subfolder=video%2FH3&type=output'))
      .toEqual({ filename: 'x.mp4', subfolder: 'video/H3' })
    expect(clipRefFromUrl('/api/gallery/video?filename=x.mp4&subfolder=video%2FH3'))
      .toEqual({ filename: 'x.mp4', subfolder: 'video/H3' })
  })

  it('returns null when there is no filename to read', () => {
    expect(clipRefFromUrl('/api/comfyui/view?type=output')).toBeNull()
    expect(clipRefFromUrl('blob:whatever')).toBeNull()
  })
})

describe('path separators across the chain', () => {
  it('normalises the Windows separators ComfyUI reports', () => {
    // ComfyUI reports a render's subfolder with OS separators; everything from
    // the gallery uses "/". Comparing the two forms never matches, and the only
    // symptom was a three-clip chain offering to join two.
    expect(clipRefFromUrl('/api/comfyui/view?filename=x.mp4&subfolder=video%5CMinimaxH3%5C2026-08-29'))
      .toEqual({ filename: 'x.mp4', subfolder: 'video/MinimaxH3/2026-08-29' })
  })

  it('lets a job output and a gallery-derived parent match', () => {
    // The exact failure: job output vs continueFrom for the same file.
    const fromJob = refToPath(clipRefFromUrl('/api/comfyui/view?filename=a.mp4&subfolder=video%5CMinimaxH3%5C2026-08-29')!)
    const fromGallery = 'video/MinimaxH3/2026-08-29/a.mp4'
    expect(fromJob).toBe(fromGallery)
    expect(deriveChain([{ path: 'b.mp4', continueFrom: fromGallery }, { path: fromJob }])).toEqual([fromGallery, 'b.mp4'])
  })
})
