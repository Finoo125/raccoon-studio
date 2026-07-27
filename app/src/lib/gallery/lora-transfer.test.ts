import { describe, expect, it } from 'vitest'
import { parseGalleryLoras, serializeGalleryLoras } from './lora-transfer'

describe('Gallery LoRA transfer', () => {
  it('round-trips names and strengths', () => {
    const loras = [
      { name: 'one.safetensors', strength: 0.5 },
      { name: 'two.safetensors', strength: 1.1 },
    ]
    expect(parseGalleryLoras(serializeGalleryLoras(loras))).toEqual(loras)
  })

  it('rejects malformed data without breaking the generate page', () => {
    expect(parseGalleryLoras('not json')).toBeUndefined()
    expect(parseGalleryLoras('{"name":"x"}')).toBeUndefined()
    expect(parseGalleryLoras('[{"name":4}]')).toBeUndefined()
  })
})
