import { describe, it, expect } from 'vitest'
import { editVideoPrefill, clipOutputPath, clipViewUrl, canContinue, continuationPrefill, sourceParamsFor } from './useContinueVideo'
import type { VideoGenerationParams } from '@/types/video-workflow'
import type { GalleryImage } from '@/types/gallery'

const clip = (over: Partial<GalleryImage> = {}): GalleryImage =>
  ({
    id: 'x',
    media: 'video',
    filename: '193337-MinimaxH3__00001_.mp4',
    subfolder: 'video/MinimaxH3/2026-08-29',
    url: '/x',
    thumbnailUrl: '/x',
    createdAt: '',
    favorite: false,
    metadata: { workflow: 'MiniMax H3 Video' },
    ...over,
  }) as GalleryImage

describe('clipOutputPath', () => {
  it('joins subfolder and filename the way LoadVideo wants', () => {
    expect(clipOutputPath(clip())).toBe('video/MinimaxH3/2026-08-29/193337-MinimaxH3__00001_.mp4')
  })

  it('handles a clip sitting at the output root', () => {
    expect(clipOutputPath(clip({ subfolder: '' }))).toBe('193337-MinimaxH3__00001_.mp4')
  })

  it('normalises Windows separators', () => {
    // This string goes into a ComfyUI node input, not a filesystem call, so it
    // must be POSIX regardless of what the gallery scan produced.
    expect(clipOutputPath(clip({ subfolder: 'video\\MinimaxH3\\2026-08-29' }))).toBe(
      'video/MinimaxH3/2026-08-29/193337-MinimaxH3__00001_.mp4',
    )
  })
})

describe('clipViewUrl', () => {
  // The inverse of clipOutputPath: the form only holds the LoadVideo path, and
  // the writer's vision pass needs to fetch the clip back out of output/ to
  // lift its last frame.
  it('turns a continueFrom path back into a proxied output view URL', () => {
    expect(clipViewUrl('video/MinimaxH3/2026-08-29/193337-MinimaxH3__00001_.mp4')).toBe(
      '/api/comfyui/view?filename=193337-MinimaxH3__00001_.mp4&subfolder=video%2FMinimaxH3%2F2026-08-29&type=output',
    )
  })

  it('handles a clip sitting at the output root', () => {
    expect(clipViewUrl('193337-MinimaxH3__00001_.mp4')).toBe(
      '/api/comfyui/view?filename=193337-MinimaxH3__00001_.mp4&subfolder=&type=output',
    )
  })
})

describe('canContinue', () => {
  it('accepts an H3 clip however the workflow name is spelled', () => {
    expect(canContinue(clip())).toBe(true)
    expect(canContinue(clip({ metadata: { workflow: 'minimax-h3' } as never }))).toBe(true)
  })

  it('refuses LTX, which has no masked-prefix equivalent', () => {
    // Offering the button here would build a graph ComfyUI rejects at
    // validation — worse than not offering it.
    expect(canContinue(clip({ metadata: { workflow: 'LTX 2.3 Video' } as never }))).toBe(false)
  })

  it('refuses images and clips with no recorded workflow', () => {
    expect(canContinue(clip({ media: 'image' }))).toBe(false)
    expect(canContinue(clip({ metadata: {} as never }))).toBe(false)
  })
})

describe('continuationPrefill', () => {
  it('names the model in videoModel, which is the field the form actually reads', () => {
    // The form resolves its workflow from `params.videoModel`; `workflowId` on
    // the prefill is never read. Without this the form stayed on whatever was
    // selected before, and on LTX the builder ignores `continueFrom` entirely —
    // so the render succeeded and quietly was not a continuation.
    const p = continuationPrefill(clip())
    expect(p.params.videoModel).toBe('minimax-h3')
    expect(p.workflowId).toBe('minimax-h3')
  })

  it('points at the source clip and clears the seed', () => {
    const p = continuationPrefill(clip())
    expect(p.params.continueFrom).toBe('video/MinimaxH3/2026-08-29/193337-MinimaxH3__00001_.mp4')
    expect(p.params.mode).toBe('t2v')
    // -1 randomises at build, so pressing Generate again re-rolls this link.
    expect(p.params.seed).toBe(-1)
  })

  it('carries the source prompt forward when there is one', () => {
    const withPrompt = clip({ metadata: { workflow: 'MinimaxH3', prompt: 'a cyclist' } as never })
    expect(continuationPrefill(withPrompt).params.prompt).toBe('a cyclist')
    // And omits the key entirely rather than writing undefined over a default.
    expect('prompt' in continuationPrefill(clip()).params).toBe(false)
  })
})

describe('continuationPrefill huntCount', () => {
  it('defaults to off and carries the dialog\'s pick', () => {
    expect(continuationPrefill(clip()).huntCount).toBe(0)
    expect(continuationPrefill(clip(), 3).huntCount).toBe(3)
  })

  it('always writes the key, so a same-route Continue cannot inherit the last hunt', () => {
    // The form keeps `huntCount` across a push to the route it is already on;
    // an undefined here would silently re-run the previous batch size.
    expect(Object.keys(continuationPrefill(clip()))).toContain('huntCount')
  })
})

describe('editVideoPrefill', () => {
  it('opens H3 Edit mode on the clip, read in place, with an empty instruction', () => {
    const p = editVideoPrefill({ filename: 'a.mp4', subfolder: 'video\\Ltx_Video', media: 'video' } as never)
    expect(p.workflowId).toBe('minimax-h3')
    expect(p.params).toMatchObject({ videoModel: 'minimax-h3', mode: 'edit', editSource: 'video/Ltx_Video/a.mp4 [output]', prompt: '' })
    // Facts are re-probed in the form, never carried from a previous clip.
    expect(p.params.editSourceFrames).toBeUndefined()
  })
})

describe('sourceParamsFor', () => {
  const view = (subfolder: string, filename: string) =>
    `/api/comfyui/view?${new URLSearchParams({ filename, subfolder, type: 'output' })}`
  const job = (over: Record<string, unknown> = {}) => ({
    kind: 'video' as const, status: 'done' as const,
    outputVideos: [view('video/MinimaxH3/2026-08-29', '193337-MinimaxH3__00001_.mp4')],
    generationParams: { mode: 'ref2v', refImages: ['me.png'] } as never,
    ...over,
  })

  it('finds the job that rendered the clip by its output path', () => {
    expect(sourceParamsFor(clip(), [job()])).toEqual({ mode: 'ref2v', refImages: ['me.png'] })
  })

  it('matches a job recorded with Windows separators', () => {
    expect(sourceParamsFor(clip(), [job({ outputVideos: [view('video\\MinimaxH3\\2026-08-29','193337-MinimaxH3__00001_.mp4')] })])).toBeDefined()
  })

  it('ignores unfinished jobs, image jobs and other clips', () => {
    expect(sourceParamsFor(clip(), [job({ status: 'running' }), job({ kind: 'image' }),
      job({ outputVideos: [view('video/MinimaxH3/2026-08-29', 'other.mp4')] })])).toBeUndefined()
  })
})

describe('continuationPrefill from a reference-mode clip', () => {
  const source = {
    prompt: '', mode: 'ref2v', durationSeconds: 10, fps: 24, seed: 1,
    refImages: ['me.png'], refImageRoles: ['character'], refVideos: ['move.mp4'], refAudios: ['voice.wav'], refHiFi: true,
  } as VideoGenerationParams

  it('stays in reference mode and carries every reference along', () => {
    const p = continuationPrefill(clip(), 0, source).params
    expect(p).toMatchObject({ mode: 'ref2v', refImages: ['me.png'], refImageRoles: ['character'],
      refVideos: ['move.mp4'], refAudios: ['voice.wav'], refHiFi: true })
  })

  it('clears the keyframes — each link picks its own destination', () => {
    const p = continuationPrefill(clip(), 0, source).params
    expect('keyframes' in p && p.keyframes === undefined).toBe(true)
  })

  it('continues in t2v when the source was not reference mode, or is unknown', () => {
    expect(continuationPrefill(clip(), 0, { ...source, mode: 'i2v' }).params.mode).toBe('t2v')
    expect(continuationPrefill(clip(), 0).params.mode).toBe('t2v')
    expect(continuationPrefill(clip(), 0).params.refImages).toBeUndefined()
  })
})

describe('continuationPrefill keeps the checkpoint of a reference-mode source', () => {
  it('carries h3Checkpoint, so the next link renders on the same model and the probe cannot drop ref2v', () => {
    const source = { prompt: '', mode: 'ref2v', durationSeconds: 10, fps: 24, seed: 1, refImages: ['me.png'], h3Checkpoint: 'eros' } as VideoGenerationParams
    expect(continuationPrefill(clip(), 0, source).params.h3Checkpoint).toBe('eros')
  })
})

describe('continuationPrefill from a reference-mode clip with no references', () => {
  it('continues in t2v rather than land in a reference mode that refuses to Generate', () => {
    const source = { prompt: '', mode: 'ref2v', durationSeconds: 10, fps: 24, seed: 1, refImages: [undefined] } as VideoGenerationParams
    expect(continuationPrefill(clip(), 0, source).params.mode).toBe('t2v')
  })
})
