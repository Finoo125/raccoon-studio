import { describe, it, expect } from 'vitest'
import { buildFaceModelPrompt } from './build-face-model'

describe('buildFaceModelPrompt', () => {
  it('builds and saves a model from a single image (no batching)', () => {
    const wf = buildFaceModelPrompt({ faceFilenames: ['a.png'], modelName: 'alice' })

    expect(wf['bfm:img0'].class_type).toBe('LoadImage')
    expect(wf['bfm:img0'].inputs.image).toBe('a.png')

    // A single image feeds the builder directly — no ImageBatch node.
    expect(wf['bfm:batch0']).toBeUndefined()

    expect(wf['bfm:build'].class_type).toBe('ReActorBuildFaceModel')
    expect(wf['bfm:build'].inputs.save_mode).toBe(true)
    expect(wf['bfm:build'].inputs.face_model_name).toBe('alice')
    expect(wf['bfm:build'].inputs.compute_method).toBe('Mean')
    expect(wf['bfm:build'].inputs.images).toEqual(['bfm:img0', 0])
  })

  it('chains ImageBatch nodes to blend multiple images', () => {
    const wf = buildFaceModelPrompt({ faceFilenames: ['a.png', 'b.png', 'c.png'], modelName: 'bob' })

    // One LoadImage per photo.
    expect(wf['bfm:img0'].inputs.image).toBe('a.png')
    expect(wf['bfm:img1'].inputs.image).toBe('b.png')
    expect(wf['bfm:img2'].inputs.image).toBe('c.png')

    // batch0 = img0 + img1; batch1 = batch0 + img2.
    expect(wf['bfm:batch0'].class_type).toBe('ImageBatch')
    expect(wf['bfm:batch0'].inputs.image1).toEqual(['bfm:img0', 0])
    expect(wf['bfm:batch0'].inputs.image2).toEqual(['bfm:img1', 0])
    expect(wf['bfm:batch1'].inputs.image1).toEqual(['bfm:batch0', 0])
    expect(wf['bfm:batch1'].inputs.image2).toEqual(['bfm:img2', 0])

    // The builder reads the final batch.
    expect(wf['bfm:build'].inputs.images).toEqual(['bfm:batch1', 0])
  })

  it('honors an explicit compute method', () => {
    const wf = buildFaceModelPrompt({ faceFilenames: ['a.png'], modelName: 'x', computeMethod: 'Median' })
    expect(wf['bfm:build'].inputs.compute_method).toBe('Median')
  })

  it('rejects an empty image list', () => {
    expect(() => buildFaceModelPrompt({ faceFilenames: [], modelName: 'x' })).toThrow()
  })
})
