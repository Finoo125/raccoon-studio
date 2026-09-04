import { describe, it, expect } from 'vitest'
import { videoPrefill, SEND_TARGET_LABEL, type SendToVideoTarget } from './useSendToVideo'

const seed = { filename: 'sheet.png', b64: 'data:image/png;base64,xx', previewUrl: '/blob/1' }
const dims = { width: 1344, height: 768 }
/** Every target the dialog can offer — derived, so a new one joins the sweeps. */
const TARGETS = Object.keys(SEND_TARGET_LABEL) as SendToVideoTarget[]

describe('videoPrefill', () => {
  it('sends a source image to LTX as an i2v start frame', () => {
    const p = videoPrefill('source', seed, dims)
    expect(p.workflowId).toBe('ltx23')
    expect(p.params.mode).toBe('i2v')
    expect(p.params.inputImage).toBe('sheet.png')
    expect(p.params.inputImageWidth).toBe(1344)
    expect(p.params.inputImageHeight).toBe(768)
  })

  it('sends a reference image to H3 slot 0, never to the start frame', () => {
    const p = videoPrefill('reference', seed, dims)
    expect(p.workflowId).toBe('minimax-h3')
    expect(p.params.mode).toBe('ref2v')
    expect(p.params.refImages).toEqual(['sheet.png'])
    // The silent failure this guards: a sheet in `inputImage` still renders —
    // H3 just animates the sheet instead of using it as an identity reference.
    expect(p.params.inputImage).toBeUndefined()
  })

  it('sends an H3 start frame to i2v, on H3 rather than LTX', () => {
    const p = videoPrefill('h3-start', seed, dims)
    expect(p.workflowId).toBe('minimax-h3')
    expect(p.params.mode).toBe('i2v')
    expect(p.params.inputImage).toBe('sheet.png')
    expect(p.params.inputImageWidth).toBe(1344)
    expect(p.params.endImage).toBeUndefined()
  })

  it('sends an H3 end frame to endImage alone — that is what makes it L2VA', () => {
    const p = videoPrefill('h3-end', seed, dims)
    expect(p.workflowId).toBe('minimax-h3')
    expect(p.params.mode).toBe('i2v')
    expect(p.params.endImage).toBe('sheet.png')
    expect(p.params.endImageWidth).toBe(1344)
    expect(p.params.endImageHeight).toBe(768)
    // Filling the start frame too would silently turn L2VA into FL2VA — a
    // different task, from an image the user pointed at the *end* of the clip.
    expect(p.params.inputImage).toBeUndefined()
  })

  it('names a mode on every target, so the form never falls back to i2v', () => {
    // `video-form-context` only forces i2v for a seed that names no mode. A
    // target that stopped naming one would silently re-file as a start frame.
    for (const t of TARGETS) {
      expect(videoPrefill(t, seed, dims).params.mode).toBeTruthy()
    }
  })

  it('carries the seed b64 on every target — it feeds the enhancer vision pass', () => {
    for (const t of TARGETS) {
      expect(videoPrefill(t, seed, dims).videoSeed?.b64).toBe(seed.b64)
    }
  })

  it('labels every target, so the dialog cannot offer one with no name', () => {
    for (const t of TARGETS) expect(SEND_TARGET_LABEL[t]).toBeTruthy()
  })
})
