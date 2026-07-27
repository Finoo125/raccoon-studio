import { describe, it, expect } from 'vitest'
import { extractMetadataFromPromptChunk, parsePngTextChunks } from './metadata'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4) // CRC is not validated by the parser
  return Buffer.concat([len, Buffer.from(type, 'ascii'), data, crc])
}

function tEXt(key: string, value: string): Buffer {
  return chunk('tEXt', Buffer.concat([Buffer.from(key, 'ascii'), Buffer.from([0]), Buffer.from(value, 'latin1')]))
}

describe('parsePngTextChunks', () => {
  it('reads tEXt chunks that appear before IDAT', () => {
    const buf = Buffer.concat([
      PNG_SIGNATURE,
      tEXt('prompt', '{"1":{}}'),
      chunk('IDAT', Buffer.from('pixels')),
    ])
    expect(parsePngTextChunks(buf).prompt).toBe('{"1":{}}')
  })

  it('stops at IDAT and ignores anything after the pixel data', () => {
    const buf = Buffer.concat([
      PNG_SIGNATURE,
      tEXt('parameters', 'hello'),
      chunk('IDAT', Buffer.from('pixels')),
      tEXt('shouldBeIgnored', 'nope'),
    ])
    const chunks = parsePngTextChunks(buf)
    expect(chunks.parameters).toBe('hello')
    expect(chunks.shouldBeIgnored).toBeUndefined()
  })

  it('returns nothing for a non-PNG buffer (e.g. a jpeg prefix)', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(parsePngTextChunks(jpeg)).toEqual({})
  })
})

describe('extractMetadataFromPromptChunk LoRAs', () => {
  it('extracts dynamic loaders and model-only loaders with strengths', () => {
    const prompt = JSON.stringify({
      '100': {
        class_type: 'LoraLoader',
        inputs: { lora_name: 'style-a.safetensors', strength_model: 0.65 },
      },
      '101': {
        class_type: 'LoraLoaderModelOnly',
        inputs: { lora_name: 'style-b.safetensors', strength_model: '0.8' },
      },
    })

    expect(extractMetadataFromPromptChunk(prompt).loras).toEqual([
      { name: 'style-a.safetensors', strength: 0.65 },
      { name: 'style-b.safetensors', strength: 0.8 },
    ])
  })

  it('extracts populated rgthree stack rows and ignores None', () => {
    const prompt = JSON.stringify({
      stack: {
        class_type: 'Lora Loader Stack (rgthree)',
        inputs: {
          lora_01: 'one.safetensors', strength_01: '0.4',
          lora_02: 'None', strength_02: '1',
          lora_03: 'three.safetensors', strength_03: 0.9,
          lora_04: 'None', strength_04: '1',
        },
      },
    })

    expect(extractMetadataFromPromptChunk(prompt).loras).toEqual([
      { name: 'one.safetensors', strength: 0.4 },
      { name: 'three.safetensors', strength: 0.9 },
    ])
  })
})
