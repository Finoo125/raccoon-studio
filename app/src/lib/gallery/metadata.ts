import type { ImageMetadata } from '@/types/gallery'

export function extractMetadataFromPromptChunk(promptJson: string): ImageMetadata {
  try {
    const nodes: Record<string, { class_type: string; inputs: Record<string, unknown> }> =
      JSON.parse(promptJson)

    const meta: ImageMetadata = {}

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

      if (ct === 'EmptyLatentImage' || ct === 'EmptySD3LatentImage' || ct === 'EmptyFlux2LatentImage') {
        meta.width = Number(inp.width)
        meta.height = Number(inp.height)
      }

      // Ernie / ZIT use PrimitiveStringMultiline for main prompt
      if (ct === 'PrimitiveStringMultiline') {
        if (!meta.prompt) meta.prompt = inp.value as string
      }
    }

    return meta
  } catch {
    return {}
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
