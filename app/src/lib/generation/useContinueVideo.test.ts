import { describe, it, expect } from 'vitest'
import { clipOutputPath, canContinue, continuationPrefill } from './useContinueVideo'
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

describe('canContinue', () => {
  it('accepts an H3 clip however the workflow name is spelled', () => {
    expect(canContinue(clip())).toBe(true)
    expect(canContinue(clip({ metadata: { workflow: 'minimax-h3' } as never }))).toBe(true)
  })

  it('refuses LTX, which has no AddGuide equivalent', () => {
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
