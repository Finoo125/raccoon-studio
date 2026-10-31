import { cancelPrompt, getHistory, queuePrompt } from '@/lib/comfyui/client'
import { KREA2_TEXT_ENCODER } from '@/lib/video/describe'
import type { ChatMessage } from '@/lib/director/ollama'
import type { ComfyUIPrompt } from '@/types/comfyui'

/** The built-in writer: Krea2's Qwen3-VL-4B encoder writing text, read back through PreviewAny. */
export function buildWriterGraph(text: string, seed: number): ComfyUIPrompt {
  return {
    'pw:clip': { class_type: 'CLIPLoader', inputs: { clip_name: KREA2_TEXT_ENCODER, type: 'krea2', device: 'default' } },
    'pw:gen': {
      class_type: 'TextGenerate',
      inputs: {
        clip: ['pw:clip', 0], prompt: text, max_length: 512,
        // thinking: true — off, Qwen3-VL-4B wrote its reasoning into the answer (Krea2 enhancer, 2026-09-30).
        thinking: true, use_default_template: true,
        sampling_mode: 'on', 'sampling_mode.temperature': 0.7, 'sampling_mode.top_k': 64, 'sampling_mode.top_p': 0.95,
        'sampling_mode.min_p': 0.05, 'sampling_mode.repetition_penalty': 1.05, 'sampling_mode.seed': seed,
        'sampling_mode.presence_penalty': 0,
      },
    },
    'pw:out': { class_type: 'PreviewAny', inputs: { source: ['pw:gen', 0] } },
  }
}

export class WriterTimeout extends Error {}

interface WriterHistory {
  outputs?: Record<string, { text?: string[] }>
  status?: { completed?: boolean; status_str?: string; messages?: [string, { exception_message?: string }][] }
}

/**
 * Run the built-in writer and return its raw answer. Queued at the front, but a
 * render already running finishes first; past `timeoutMs` (90 s — under
 * RunPod's ~125 s idle cutoff) the job is taken back out of the queue.
 */
export async function runBuiltinWriter(
  messages: ChatMessage[],
  opts: { timeoutMs?: number; intervalMs?: number; seed?: number } = {},
): Promise<string> {
  const text = messages.map((m) => m.content).join('\n\n')
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31)
  const { prompt_id } = await queuePrompt(buildWriterGraph(text, seed), 'prompt-helper', true)
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000)
  for (;;) {
    const entry = (await getHistory(prompt_id))[prompt_id] as WriterHistory | undefined
    if (entry?.status?.status_str === 'error') {
      const err = entry.status.messages?.find(([kind]) => kind === 'execution_error')?.[1]?.exception_message
      throw new Error(err ?? 'The built-in writer failed in ComfyUI')
    }
    if (entry?.status?.completed) return entry.outputs?.['pw:out']?.text?.[0] ?? ''
    if (Date.now() >= deadline) {
      await cancelPrompt(prompt_id).catch(() => {})
      throw new WriterTimeout('Still busy rendering — try again in a moment')
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 500))
  }
}
