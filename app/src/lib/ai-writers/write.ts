import { chatText, type ChatMessage } from '@/lib/director/ollama'
import { runBuiltinWriter } from '@/lib/prompt-builder/writer'
import { getSettings } from '@/lib/settings/settings'
import { currentLmsPort } from './lmstudio'
import { PROBE_PORTS, probeAddress, serverIdOf, type SavedServer } from './openai-server'
import { parseWriterId } from './writer-id'

export interface WriteDeps {
  builtin: (messages: ChatMessage[]) => Promise<string>
  ollama: (model: string, messages: ChatMessage[], opts: { think?: boolean }) => Promise<string>
  openai: (baseUrl: string, model: string, messages: ChatMessage[], extra: Record<string, unknown>) => Promise<string>
  thinks: (model: string) => Promise<boolean>
  saved: () => SavedServer[]
  lmsPort: () => number
}

const lmsQueue = ((globalThis as unknown as { __raccoonLmsQueue?: { tail: Promise<unknown> } }).__raccoonLmsQueue ??=
  { tail: Promise.resolve() })

/** A server id → its address: one the user added, or one of the usual local ports. Never a URL from a request. */
export function serverAddress(id: string, saved: readonly SavedServer[]): string | null {
  const known = [...saved.map((s) => s.address), ...PROBE_PORTS.map((p) => probeAddress(p.port))]
  return saved.find((s) => s.id === id)?.address ?? known.find((a) => serverIdOf(a) === id) ?? null
}

/** One answer from the writer an id names. Start a switched-off app first (ensureRunning) — once, not per version. */
export async function writeWith(id: string, messages: ChatMessage[], over: Partial<WriteDeps> = {}): Promise<string> {
  const d = { ...defaults(), ...over }
  const ref = parseWriterId(id)
  if (!ref) throw new Error('Pick a writer first')
  switch (ref.kind) {
    case 'builtin':
      return d.builtin(messages)
    case 'ollama':
      // A thinking model thinks for seconds before every answer unless told not
      // to — 6–10 s against under 1 s per description (qwen3.5:4b, 2026-10-10).
      return d.ollama(ref.model, messages, (await d.thinks(ref.model)) ? { think: false } : {})
    case 'lmstudio': {
      // A model LM Studio loads just for us unloads 5 s after writing; one the user loaded stays.
      // One at a time: on a cold model the first request loads it and parallel ones 500 at once.
      // ponytail: one queue for all of LM Studio; per-model queues if anyone mixes models at once.
      const turn = lmsQueue.tail.then(() => d.openai(`http://127.0.0.1:${d.lmsPort()}`, ref.model, messages, { ttl: 5 }))
      lmsQueue.tail = turn.catch(() => undefined)
      return turn
    }
    case 'server': {
      const address = serverAddress(ref.server, d.saved())
      if (!address) throw new Error('That AI server isn’t in the list any more. Scan again.')
      return d.openai(address, ref.model, messages, {})
    }
  }
}

/** An OpenAI-style chat call (LM Studio, llama.cpp, KoboldCpp, Jan, …). */
export async function chatOpenAI(baseUrl: string, model: string, messages: ChatMessage[], extra: Record<string, unknown> = {},
  fetcher: typeof fetch = fetch, timeoutMs = 90_000): Promise<string> {
  const res = await fetcher(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: messages.map(({ role, content }) => ({ role, content })),
      temperature: 0.8, max_tokens: 800, stream: false, ...extra }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return (j.choices?.[0]?.message?.content ?? '').trim()
}

const thinking: Map<string, boolean> =
  ((globalThis as unknown as { __raccoonOllamaThinks?: Map<string, boolean> }).__raccoonOllamaThinks ??= new Map())

/** Whether an Ollama model has the thinking switch — asked once per model. */
async function ollamaThinks(model: string): Promise<boolean> {
  const known = thinking.get(model)
  if (known !== undefined) return known
  try {
    const r = await fetch(`${getSettings().ollamaBaseUrl}/api/show`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(3000),
    })
    const caps = r.ok ? ((await r.json()) as { capabilities?: string[] }).capabilities ?? [] : []
    thinking.set(model, caps.includes('thinking'))
    return caps.includes('thinking')
  } catch {
    return false
  }
}

function defaults(): WriteDeps {
  return {
    builtin: (m) => runBuiltinWriter(m),
    ollama: (model, m, opts) => chatText(model, m, undefined, opts),
    openai: (base, model, m, extra) => chatOpenAI(base, model, m, extra),
    thinks: ollamaThinks,
    saved: () => getSettings().aiServers,
    lmsPort: currentLmsPort,
  }
}
