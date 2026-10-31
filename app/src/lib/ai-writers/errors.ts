import type { WriterRef } from './writer-id'

const DOWN = /fetch failed|ECONNREFUSED|ECONNRESET|socket hang up|other side closed/i

/** A refused request ("400: {…}" from an OpenAI-style server, "failed (500)" from Ollama). */
const REFUSED = /^\d{3}: |failed \(\d{3}\)/
const SLOW = /aborted due to timeout|timed out|TimeoutError/i

/** Plain words for the failures a beginner can fix, naming the program to fix. */
export function writerErrorMessage(err: unknown, ref: WriterRef, address?: string): string {
  const msg = err instanceof Error ? err.message : String(err)
  const down = DOWN.test(msg) || DOWN.test(String((err as { cause?: unknown })?.cause ?? ''))
  const slow = SLOW.test(msg) || (err as { name?: string })?.name === 'TimeoutError'
  const host = (address ?? 'that address').replace(/^https?:\/\//, '')
  // Whoever answers, a refusal or a timeout reads the same way.
  const app = ref.kind === 'ollama' ? 'Ollama' : ref.kind === 'lmstudio' ? 'LM Studio' : `The AI server at ${host}`
  const model = ref.kind === 'lmstudio' ? 'that model' : ref.kind === 'builtin' ? '' : ref.model
  if (ref.kind !== 'builtin' && slow) return `${app} took too long to answer. Try again, or pick a smaller model.`
  if (ref.kind !== 'builtin' && REFUSED.test(msg)) return `${app} couldn’t write with ${model}. Try again, or pick another writer.`
  switch (ref.kind) {
    case 'builtin':
      if (/value_not_in_list|qwen3vl_4b/i.test(msg)) return 'The built-in writer isn’t downloaded yet. Set it up in AI writer setup.'
      return down ? 'ComfyUI is not running. Start ComfyUI, then try again.' : msg
    case 'ollama':
      if (/not found/i.test(msg)) return `Ollama doesn’t have ${ref.model}. Pick another model, or set it up again.`
      return down ? 'Ollama is not running. Start it, or choose another writer.' : msg
    case 'lmstudio':
      return down ? 'LM Studio didn’t answer. Start it, or choose another writer.' : msg
    case 'server':
      return down ? `Nothing answered at ${host}. Is the server running?` : msg
  }
}
