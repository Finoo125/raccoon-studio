import { describe, expect, it } from 'vitest'
import { galleryMetadataToGenerationParams } from './reuse-settings'

describe('galleryMetadataToGenerationParams', () => {
  it('includes dynamic LoRA names and strengths', () => {
    expect(galleryMetadataToGenerationParams({
      prompt: 'a raccoon',
      seed: 42,
      loras: [
        { name: 'one.safetensors', strength: 0.5 },
        { name: 'two.safetensors', strength: 1.1 },
      ],
    })).toEqual({
      prompt: 'a raccoon',
      seed: 42,
      loras: [
        { name: 'one.safetensors', strength: 0.5 },
        { name: 'two.safetensors', strength: 1.1 },
      ],
    })
  })

  it('does not add an empty LoRA array', () => {
    expect(galleryMetadataToGenerationParams({ prompt: 'x', loras: [] }))
      .toEqual({ prompt: 'x' })
  })
})
