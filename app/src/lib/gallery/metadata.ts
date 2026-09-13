import type { ImageMetadata } from '@/types/gallery'

export function extractMetadataFromPromptChunk(promptJson: string): ImageMetadata {
  try {
    const nodes: Record<string, { class_type: string; inputs: Record<string, unknown> }> =
      JSON.parse(promptJson)

    const meta: ImageMetadata = {}
    const loras: NonNullable<ImageMetadata['loras']> = []

    const addLora = (name: unknown, strength: unknown) => {
      if (typeof name !== 'string' || !name || name === 'None') return
      const parsedStrength =
        typeof strength === 'number' ? strength :
          typeof strength === 'string' && strength.trim() !== '' ? Number(strength) :
            undefined
      loras.push({
        name,
        ...(parsedStrength !== undefined && Number.isFinite(parsedStrength)
          ? { strength: parsedStrength }
          : {}),
      })
    }

    for (const node of Object.values(nodes)) {
      const ct = node.class_type
      const inp = node.inputs ?? {}

      if (ct === 'CLIPTextEncode') {
        const text = inp.text as string | undefined
        if (!text) continue
        // Heuristic: negative prompts tend to contain quality penalty words
        const looksNegative = /worst quality|low quality|score_1|nsfw/i.test(text)
        if (looksNegative) {
          meta.negativePrompt = text
        } else if (!meta.prompt) {
          meta.prompt = text
        }
      }

      if (ct === 'KSampler') {
        meta.seed = Number(inp.seed)
        meta.steps = Number(inp.steps)
        meta.cfg = Number(inp.cfg)
        meta.sampler = inp.sampler_name as string
        meta.scheduler = inp.scheduler as string
      }

      if (ct === 'UNETLoader') meta.model = inp.unet_name as string
      if (ct === 'CheckpointLoaderSimple') meta.model = inp.ckpt_name as string

      if (ct === 'LoraLoader' || ct === 'LoraLoaderModelOnly') {
        addLora(inp.lora_name, inp.strength_model)
      }

      if (ct === 'Lora Loader Stack (rgthree)') {
        for (let i = 1; i <= 4; i += 1) {
          const slot = String(i).padStart(2, '0')
          addLora(inp[`lora_${slot}`], inp[`strength_${slot}`])
        }
      }

      if (ct === 'EmptyLatentImage' || ct === 'EmptySD3LatentImage' || ct === 'EmptyFlux2LatentImage') {
        meta.width = Number(inp.width)
        meta.height = Number(inp.height)
      }

      // Ernie / ZIT use PrimitiveStringMultiline for main prompt
      if (ct === 'PrimitiveStringMultiline') {
        if (!meta.prompt) meta.prompt = inp.value as string
      }
    }

    if (loras.length > 0) meta.loras = loras
    return meta
  } catch {
    return {}
  }
}

/**
 * The preset id the app stamps into every job it submits (see `presetStamp`):
 * ComfyUI writes each `extra_pnginfo` key as its own JSON-encoded tEXt chunk.
 * Absent on anything the app did not render, and on renders from before the
 * stamp existed.
 */
export function extractPreset(chunks: Record<string, string>): string | undefined {
  try {
    const preset: unknown = JSON.parse(chunks.raccoon ?? '').preset
    return typeof preset === 'string' ? preset : undefined
  } catch {
    return undefined
  }
}

/**
 * Parse the A1111 / Forge / reForge "parameters" tEXt chunk. Many images in the
 * gallery were produced by sd-webui-style tools rather than ComfyUI, so they
 * carry this flat text format instead of ComfyUI's `prompt` JSON. Example:
 *
 *   <positive prompt>
 *   Negative prompt: <negative>
 *   Steps: 9, Sampler: Euler, Schedule type: Beta, CFG scale: 1, Seed: 123,
 *   Size: 1152x896, Model: aria_zit_01, ...
 */
export function extractMetadataFromParameters(text: string): ImageMetadata {
  const meta: ImageMetadata = {}
  if (!text) return meta

  const lines = text.split(/\r?\n/)

  // Locate the trailing settings line ("Steps: ..., Seed: ...").
  let settingsIdx = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/(^|,\s*)(Steps|Sampler|Seed|CFG scale|Size):/i.test(lines[i])) {
      settingsIdx = i
      break
    }
  }
  const settingsLine = settingsIdx >= 0 ? lines[settingsIdx] : ''
  const head = (settingsIdx >= 0 ? lines.slice(0, settingsIdx) : lines).join('\n')

  // Split positive / negative prompt.
  const negMatch = head.match(/\bNegative prompt:/i)
  if (negMatch && negMatch.index !== undefined) {
    meta.prompt = head.slice(0, negMatch.index).trim() || undefined
    meta.negativePrompt = head.slice(negMatch.index + negMatch[0].length).trim() || undefined
  } else {
    meta.prompt = head.trim() || undefined
  }

  // Parse the comma-separated "Key: value" settings.
  const settings: Record<string, string> = {}
  for (const part of settingsLine.split(',')) {
    const kv = part.match(/^\s*([^:]+):\s*(.*)$/)
    if (kv) settings[kv[1].trim().toLowerCase()] = kv[2].trim()
  }
  const num = (v?: string) =>
    v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined

  meta.steps = num(settings['steps'])
  meta.cfg = num(settings['cfg scale'])
  meta.seed = num(settings['seed'])
  if (settings['sampler']) meta.sampler = settings['sampler']
  if (settings['schedule type']) meta.scheduler = settings['schedule type']
  if (settings['model']) meta.model = settings['model']

  const sizeMatch = settings['size']?.match(/(\d+)\s*x\s*(\d+)/i)
  if (sizeMatch) {
    meta.width = Number(sizeMatch[1])
    meta.height = Number(sizeMatch[2])
  }

  return meta
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/**
 * Extract tEXt chunks from a PNG. ComfyUI ("prompt"/"workflow") and A1111
 * ("parameters") write their text chunks *before* the IDAT pixel data, so we
 * stop at the first IDAT/IEND — this lets callers pass only a header prefix of
 * the file instead of reading megabytes of pixel data per image.
 */
export function parsePngTextChunks(buffer: Buffer): Record<string, string> {
  const chunks: Record<string, string> = {}
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return chunks

  let i = 8 // skip PNG signature

  while (i + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(i)
    const type = buffer.toString('ascii', i + 4, i + 8)

    // Pixel data onward holds no text chunks — stop (also bounds a prefix read).
    if (type === 'IDAT' || type === 'IEND') break

    if (type === 'tEXt') {
      const data = buffer.subarray(i + 8, i + 8 + length)
      const nullIdx = data.indexOf(0)
      if (nullIdx !== -1) {
        const key = data.toString('ascii', 0, nullIdx)
        const value = data.toString('latin1', nullIdx + 1)
        chunks[key] = value
      }
    }

    i += 12 + length
  }

  return chunks
}

let crcTable: Uint32Array | null = null

/** PNG chunk CRC (IEEE 802.3, the one every PNG chunk carries in its last 4 bytes). */
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * Splice tEXt chunks into a PNG, immediately after IHDR (where ComfyUI puts its
 * own, and where `parsePngTextChunks` will find them). Used to carry a generated
 * image's `prompt`/`workflow` recipe across a re-encode — a canvas export drops
 * every ancillary chunk, which would otherwise strip the seed, prompt and LoRAs
 * off any image that passes through the photo editor.
 *
 * Values round-trip as latin1, the same encoding the parser reads, so bytes come
 * out exactly as they went in. A non-PNG buffer (a JPEG export) is returned
 * untouched.
 */
export function injectPngTextChunks(png: Buffer, chunks: Record<string, string>): Buffer {
  const keys = Object.keys(chunks)
  if (keys.length === 0) return png
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return png

  // IHDR is required to be the first chunk: 8 (signature) + 12 (frame) + its length.
  const ihdrEnd = 8 + 12 + png.readUInt32BE(8)
  if (ihdrEnd > png.length) return png

  const encoded = keys.map((key) => {
    const data = Buffer.concat([
      Buffer.from(key, 'latin1'),
      Buffer.from([0]),
      Buffer.from(chunks[key], 'latin1'),
    ])
    const out = Buffer.allocUnsafe(data.length + 12)
    out.writeUInt32BE(data.length, 0)
    out.write('tEXt', 4, 'ascii')
    data.copy(out, 8)
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
    return out
  })

  return Buffer.concat([png.subarray(0, ihdrEnd), ...encoded, png.subarray(ihdrEnd)])
}
