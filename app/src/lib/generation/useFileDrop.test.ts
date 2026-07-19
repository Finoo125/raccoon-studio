import { describe, it, expect } from 'vitest'
import { isAcceptedFile } from './useFileDrop'

describe('isAcceptedFile', () => {
  it('accepts any image when accept is image/*', () => {
    expect(isAcceptedFile({ type: 'image/png' }, 'image/*')).toBe(true)
    expect(isAcceptedFile({ type: 'image/jpeg' }, 'image/*')).toBe(true)
    expect(isAcceptedFile({ type: 'image/webp' }, 'image/*')).toBe(true)
  })

  it('rejects non-image files when accept is image/*', () => {
    expect(isAcceptedFile({ type: 'video/mp4' }, 'image/*')).toBe(false)
    expect(isAcceptedFile({ type: 'application/pdf' }, 'image/*')).toBe(false)
    expect(isAcceptedFile({ type: '' }, 'image/*')).toBe(false)
  })

  it('accepts exact MIME match for specific accept strings', () => {
    expect(isAcceptedFile({ type: 'image/png' }, 'image/png')).toBe(true)
    expect(isAcceptedFile({ type: 'image/jpeg' }, 'image/png')).toBe(false)
  })
})
