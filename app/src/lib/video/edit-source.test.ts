import { describe, it, expect } from 'vitest'
import { editSourceRef, editSourceUrl, framesFromDuration } from './edit-source'

describe('editSourceRef', () => {
  it('reads an output path with the annotation', () => {
    expect(editSourceRef('video/MinimaxH3/2026-09-06/a.mp4 [output]'))
      .toEqual({ filename: 'a.mp4', subfolder: 'video/MinimaxH3/2026-09-06', type: 'output' })
  })
  it('reads a bare input filename', () => {
    expect(editSourceRef('clip.mp4')).toEqual({ filename: 'clip.mp4', subfolder: '', type: 'input' })
  })
  it('refuses traversal', () => {
    expect(() => editSourceRef('../secret.mp4')).toThrow()
    expect(() => editSourceRef('a/../../b.mp4 [output]')).toThrow()
  })
})

describe('editSourceUrl', () => {
  it('points the proxy at the clip, gallery or upload', () => {
    expect(editSourceUrl('video/MinimaxH3/2026-09-06/a b.mp4 [output]'))
      .toBe('/api/comfyui/view?filename=a%20b.mp4&subfolder=video%2FMinimaxH3%2F2026-09-06&type=output')
    expect(editSourceUrl('clip.mp4')).toBe('/api/comfyui/view?filename=clip.mp4&subfolder=&type=input')
    expect(() => editSourceUrl('../secret.mp4')).toThrow()
  })
})

describe('framesFromDuration', () => {
  it('counts 24 fps frames without float drift', () => {
    expect(framesFromDuration(5.1666667)).toBe(124)
    expect(framesFromDuration(15.083333)).toBe(362)
    expect(framesFromDuration(15.083)).toBe(362) // ffprobe's millisecond rounding
    expect(framesFromDuration(5.199)).toBe(124) // never over-count: a guide one frame short loses 17
    expect(framesFromDuration(0)).toBe(0)
  })
})

import { editBlockReason } from './edit-source'

describe('editBlockReason', () => {
  const ok = { mode: 'edit', prompt: 'x', editSource: 'a.mp4', editSourceWidth: 864, editSourceHeight: 480, editSourceFrames: 124 } as const
  it('passes a probed, short clip', () => { expect(editBlockReason({ ...ok } as never)).toBeNull() })
  it('waits for the probe', () => { expect(editBlockReason({ ...ok, editSourceFrames: undefined } as never)).toMatch(/reading/) })
  it('asks for a clip', () => { expect(editBlockReason({ ...ok, editSource: undefined } as never)).toMatch(/clip/) })
  it('refuses a long clip with its length in the message', () => {
    expect(editBlockReason({ ...ok, editSourceFrames: 480 } as never)).toBe('This clip is 20.0 s — Edit takes up to 15 s. Trim it first.')
  })
  it('says nothing outside edit mode', () => { expect(editBlockReason({ ...ok, mode: 't2v', editSource: undefined } as never)).toBeNull() })
})

import { editInstallReason, refCheckpointReason, editHasInstruction, withEditKindChange } from './edit-source'
import type { H3CheckpointId, VideoGenerationParams } from '@/types/video-workflow'

describe('editInstallReason', () => {
  const p = { mode: 'edit', editKind: 'vfx', h3Checkpoint: 'eros' } as never
  const all = { editReady: { vfx: true, style: true, head: true, ffp: true }, erosReady: true, ref2vReady: false }
  it('passes when the kind and the checkpoint it renders are installed', () => {
    expect(editInstallReason(p, all)).toBeNull()
  })
  it('names the missing edit LoRA', () => {
    expect(editInstallReason(p, { ...all, editReady: { vfx: false, style: true, head: true, ffp: true } })).toMatch(/Change something.*Models page/)
  })
  it('names the missing checkpoint — stock edits render the reference weights', () => {
    expect(editInstallReason({ mode: 'edit', editKind: 'vfx', h3Checkpoint: 'base' } as never, all)).toMatch(/reference model/)
  })
  it('says nothing outside edit mode', () => {
    expect(editInstallReason({ mode: 't2v' } as never, { ...all, editReady: { vfx: false, style: false, head: false, ffp: false } })).toBeNull()
  })
  it('checks the Hybrid file when the Hybrid is picked', () => {
    const hy = { mode: 'edit', editKind: 'vfx', h3Checkpoint: 'hybrid' } as never
    expect(editInstallReason(hy, { ...all, hybridReady: false })).toMatch(/Hybrid checkpoint/)
    expect(editInstallReason(hy, { ...all, hybridReady: true })).toBeNull()
  })
})

describe('refCheckpointReason', () => {
  const ready = { editReady: { vfx: true, style: true, head: true, ffp: true }, erosReady: true, ref2vReady: false, hybridReady: true }
  const ref = (h3Checkpoint: H3CheckpointId) => ({ prompt: 'x', mode: 'ref2v', durationSeconds: 10, fps: 24, seed: 1, h3Checkpoint }) as VideoGenerationParams
  it('lets reference mode render on Eros or the Hybrid without the stock ref2va file', () => {
    expect(refCheckpointReason(ref('eros'), ready)).toBeNull()
    expect(refCheckpointReason(ref('hybrid'), ready)).toBeNull()
  })
  it('says what to install when the Standard pick has no ref2va file', () => {
    expect(refCheckpointReason(ref('base'), ready)).toMatch(/^Reference mode on the Standard checkpoint needs/)
  })
  it('names the picked file when that one is missing', () => {
    expect(refCheckpointReason(ref('eros'), { ...ready, erosReady: false })).toMatch(/10Eros/)
  })
  it('names the SparseRef15 checkpoint when it is missing, and needs nothing else', () => {
    expect(refCheckpointReason(ref('sparseref'), ready)).toBe('Install the SparseRef15 checkpoint on the Models page first.')
    expect(refCheckpointReason(ref('sparseref'), { ...ready, erosReady: false, hybridReady: false, sparserefReady: true })).toBeNull()
  })
})

describe('swap head', () => {
  const p = { prompt: 'x', mode: 'edit', durationSeconds: 5, fps: 24, seed: 1, editSource: 'a.mp4', editSourceWidth: 608, editSourceHeight: 1056, editSourceFrames: 192, editKind: 'head' } as VideoGenerationParams
  const ready = { editReady: { vfx: true, style: true, head: true, ffp: true }, erosReady: true, ref2vReady: true }
  it('head needs a face picture', () => {
    expect(editBlockReason(p)).toMatch(/face picture/)
    expect(editBlockReason({ ...p, editPictures: ['f.png'] })).toBeNull()
  })
  it('needs its LoRA', () => {
    expect(editInstallReason({ ...p, editPictures: ['f.png'] }, { ...ready, editReady: { ...ready.editReady, head: false } })).toMatch(/Swap head/)
  })
})

describe('first frame', () => {
  const p = { prompt: 'x', mode: 'edit', durationSeconds: 5, fps: 24, seed: 1, editSource: 'a.mp4', editSourceWidth: 608, editSourceHeight: 1056, editSourceFrames: 192, editKind: 'vfx', editFirstFrame: 'f.png' } as VideoGenerationParams
  it('needs the FFP LoRA', () => {
    const ready = { editReady: { vfx: true, style: true, head: true, ffp: false }, erosReady: true, ref2vReady: true }
    expect(editInstallReason(p, ready)).toMatch(/First-frame/)
    expect(editInstallReason(p, { ...ready, editReady: { ...ready.editReady, ffp: true } })).toBeNull()
  })
})

describe('loose', () => {
  const p = { prompt: 'x', mode: 'edit', durationSeconds: 5, fps: 24, seed: 1, editSource: 'a.mp4', editSourceWidth: 608, editSourceHeight: 1056, editSourceFrames: 192, editFollow: 'loose', editKind: 'head' } as VideoGenerationParams
  const none = { editReady: { vfx: false, style: false, head: false, ffp: false }, erosReady: true, ref2vReady: true }
  it('loose needs no LoRA', () => {
    expect(editInstallReason(p, none)).toBeNull()
    expect(editInstallReason({ ...p, editFollow: 'exact', editKind: 'vfx' }, none)).toMatch(/Change something/)
  })
  it('a loose head swap needs no face picture', () => {
    expect(editBlockReason(p)).toBeNull()
  })
})

describe('review fixes (phase 2b/3)', () => {
  const p = { prompt: '', mode: 'edit', durationSeconds: 5, fps: 24, seed: 1, editSource: 'a.mp4', editSourceWidth: 608, editSourceHeight: 1056, editSourceFrames: 192 } as VideoGenerationParams
  it('Swap head may Generate with an empty instruction when the face is described', () => {
    expect(editHasInstruction({ ...p, prompt: '  ' })).toBe(false)
    expect(editHasInstruction({ ...p, prompt: 'x' })).toBe(true)
    expect(editHasInstruction({ ...p, editKind: 'head', editPictures: ['f.png'], editPictureNotes: ['man, forties'] })).toBe(true)
    expect(editHasInstruction({ ...p, editKind: 'head', editPictures: ['f.png'] })).toBe(false)
    // Loosely is never a head swap, so a leftover face note does not count.
    expect(editHasInstruction({ ...p, editKind: 'head', editFollow: 'loose', editPictures: ['f.png'], editPictureNotes: ['man'] })).toBe(false)
  })
  it('a kind or follow change that flips Swap head clears the descriptions (different question)', () => {
    const base = { ...p, editKind: 'head' as const, editPictures: ['f.png'], editPictureNotes: ['face only'] }
    expect(withEditKindChange(base, { editKind: 'vfx' }).editPictureNotes).toBeUndefined()
    expect(withEditKindChange(base, { editFollow: 'loose' }).editPictureNotes).toBeUndefined()
    expect(withEditKindChange({ ...base, editKind: 'vfx' }, { editKind: 'style' }).editPictureNotes).toEqual(['face only'])
    expect(withEditKindChange(base, { editKind: 'vfx' }).editKind).toBe('vfx')
  })
  it('with no edit LoRA, Exactly points at Loosely', () => {
    const none = { editReady: { vfx: false, style: false, head: false, ffp: false }, erosReady: true, ref2vReady: true }
    expect(editInstallReason({ ...p, editKind: 'vfx' }, none)).toMatch(/Loosely/)
  })
})
