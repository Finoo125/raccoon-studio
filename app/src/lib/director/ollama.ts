import type { DirectorImageModel, ParsedStoryboard } from '@/types/director'
import { getSettings } from '@/lib/settings/settings'

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

const OLLAMA_BASE_URL = () => getSettings().ollamaBaseUrl

function styleHint(imageModel: DirectorImageModel): string {
  return imageModel === 'anima'
    ? 'The opening-image prompt must describe a stylised ANIME / illustrated frame (cel shading, expressive linework, vibrant anime aesthetic).'
    : 'The opening-image prompt must describe a PHOTOREAL cinematic frame (natural light, real textures, filmic depth of field).'
}

export function buildStoryboardMessages(
  plot: string,
  beatCount: number,
  imageModel: DirectorImageModel,
): ChatMessage[] {
  const system = [
    'You are a film director turning a written plot into a storyboard for an AI video pipeline.',
    `Produce exactly ${beatCount} beat prompts. Each beat is a 15-second image-to-video clip.`,
    'The clips play back-to-back and each one continues from the LAST FRAME of the previous clip,',
    'so the beats must read as a single continuous, evolving progression - no hard cuts, no scene resets.',
    'Also produce ONE opening-image prompt that establishes the very first frame of clip 1.',
    styleHint(imageModel),
    'Respond with STRICT JSON only (no prose, no markdown) matching:',
    '{"openingImagePrompt": string, "negativePrompt": string, "beats": string[]}',
    `The "beats" array MUST have exactly ${beatCount} entries.`,
  ].join(' ')

  const user = `Plot:\n${plot}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** Strip ```/```json fences and trim. */
function stripFences(raw: string): string {
  const trimmed = raw.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return (fence ? fence[1] : trimmed).trim()
}

export function parseStoryboard(raw: string): ParsedStoryboard {
  const json = stripFences(raw)
  let obj: unknown
  try {
    obj = JSON.parse(json)
  } catch {
    throw new Error('Storyboard response was not valid JSON')
  }
  const o = obj as Record<string, unknown>
  const opening = typeof o.openingImagePrompt === 'string' ? o.openingImagePrompt.trim() : ''
  const beatsRaw = Array.isArray(o.beats) ? o.beats : []
  const beats = beatsRaw
    .map((b) => (typeof b === 'string' ? b.trim() : String(b ?? '').trim()))
    .filter((b) => b.length > 0)
  if (!opening) throw new Error('Storyboard is missing openingImagePrompt')
  if (beats.length === 0) throw new Error('Storyboard has no beats')
  const negative =
    typeof o.negativePrompt === 'string' && o.negativePrompt.trim()
      ? o.negativePrompt.trim()
      : undefined
  return { openingImagePrompt: opening, negativePrompt: negative, beats }
}

/** GET the installed Ollama model names. Never throws - returns [] on failure. */
export async function listOllamaModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL()}/api/tags`, { cache: 'no-store' })
    if (!res.ok) return []
    const data = (await res.json()) as { models?: { name?: string }[] }
    return (data.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
  } catch {
    return []
  }
}

/** Per-request budget for a storyboard generation; overridable via env. */
const STORYBOARD_TIMEOUT_MS = () => getSettings().ollamaTimeoutMs

/**
 * Context window requested for storyboard generation. Models default to a huge
 * native context (e.g. 256k) whose KV cache can exceed VRAM, making Ollama spill
 * layers to CPU (slow). A storyboard prompt is tiny, so we cap the window to keep
 * the model fully GPU-resident. Overridable via env.
 */
const OLLAMA_NUM_CTX = () => getSettings().ollamaNumCtx

/**
 * Call Ollama /api/chat with JSON format and return the raw message content.
 *
 * Bounded by an abort timeout: a slow or unsuitable model (e.g. a large base
 * model that can't satisfy the JSON grammar) would otherwise hang the request
 * forever. On timeout we surface an actionable error instead of stalling.
 */
export async function chatStoryboard(
  model: string,
  messages: ChatMessage[],
  timeoutMs: number = STORYBOARD_TIMEOUT_MS(),
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${OLLAMA_BASE_URL()}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        format: 'json',
        stream: false,
        keep_alive: 0,
        options: { num_ctx: OLLAMA_NUM_CTX() },
      }),
      signal: controller.signal,
    })
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(
        `Ollama did not respond within ${Math.round(timeoutMs / 1000)}s — "${model}" may be too slow or unable to produce JSON. Try a faster instruct model (e.g. qwen3-coder).`,
      )
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    throw new Error(`Ollama /api/chat failed (${res.status})`)
  }
  const data = (await res.json()) as { message?: { content?: string } }
  return data.message?.content ?? ''
}

/**
 * Call Ollama /api/chat for free-form text (no JSON grammar) and return the
 * message content. Bounded by the same abort timeout as chatStoryboard.
 */
export async function chatText(
  model: string,
  messages: ChatMessage[],
  timeoutMs: number = STORYBOARD_TIMEOUT_MS(),
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${OLLAMA_BASE_URL()}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        keep_alive: 0,
        options: { num_ctx: OLLAMA_NUM_CTX() },
      }),
      signal: controller.signal,
    })
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(
        `Ollama did not respond within ${Math.round(timeoutMs / 1000)}s — "${model}" may be too slow. Try a faster instruct model.`,
      )
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new Error(`Ollama /api/chat failed (${res.status})`)
  const data = (await res.json()) as { message?: { content?: string } }
  return (data.message?.content ?? '').trim()
}
