import { describe, it, expect } from 'vitest'
import { crc32 } from 'zlib'
import { extractMetadataFromPromptChunk, extractPreset, injectPngTextChunks, parsePngTextChunks } from './metadata'

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

describe('injectPngTextChunks', () => {
  // A canvas re-encode (the photo editor's save path) produces a PNG with no
  // ancillary chunks at all, so the generation recipe has to be spliced back in.
  const ihdr = () => chunk('IHDR', Buffer.alloc(13))
  const bare = () => Buffer.concat([PNG_SIGNATURE, ihdr(), chunk('IDAT', Buffer.from('pixels'))])

  it('round-trips through the parser byte-for-byte', () => {
    const meta = { prompt: '{"1":{"class_type":"KSampler"}}', workflow: '{"nodes":[]}' }
    expect(parsePngTextChunks(injectPngTextChunks(bare(), meta))).toEqual(meta)
  })

  it('keeps the signature and IHDR first, so the file stays a valid PNG', () => {
    const out = injectPngTextChunks(bare(), { prompt: 'x' })
    expect(out.subarray(0, 8)).toEqual(PNG_SIGNATURE)
    expect(out.toString('ascii', 12, 16)).toBe('IHDR')
    expect(out.indexOf(Buffer.from('tEXt'))).toBeGreaterThan(out.indexOf(Buffer.from('IHDR')))
    expect(out.indexOf(Buffer.from('tEXt'))).toBeLessThan(out.indexOf(Buffer.from('IDAT')))
  })

  it('writes a CRC a decoder will accept', () => {
    const out = injectPngTextChunks(bare(), { a: 'b' })
    const at = out.indexOf(Buffer.from('tEXt')) - 4
    const len = out.readUInt32BE(at)
    // zlib.crc32 as an independent oracle. The implementation rolls its own table
    // because `engines.node` allows 20.9, and zlib.crc32 only lands in 20.15.
    expect(out.readUInt32BE(at + 8 + len)).toBe(crc32(out.subarray(at + 4, at + 8 + len)))
  })

  it('preserves latin1 bytes above 0x7f', () => {
    const value = 'café ÿ'
    const out = injectPngTextChunks(bare(), { prompt: value })
    expect(parsePngTextChunks(out).prompt).toBe(value)
  })

  it('leaves a JPEG (or an empty chunk set) untouched', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(injectPngTextChunks(jpeg, { prompt: 'x' })).toEqual(jpeg)
    expect(injectPngTextChunks(bare(), {})).toEqual(bare())
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

describe('extractPreset', () => {
  it('reads the preset id the app stamps through extra_pnginfo', () => {
    // ComfyUI writes each extra_pnginfo key as its own tEXt chunk, JSON-encoded.
    expect(extractPreset({ raccoon: '{"preset": "pony"}' })).toBe('pony')
  })

  it('ignores images without a stamp, or with a malformed one', () => {
    expect(extractPreset({ prompt: '{}' })).toBeUndefined()
    expect(extractPreset({ raccoon: 'not json' })).toBeUndefined()
    expect(extractPreset({ raccoon: '{"preset": 42}' })).toBeUndefined()
  })
})
