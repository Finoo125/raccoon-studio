/** Where llama.cpp-style servers listen by default. LM Studio and Ollama have their own rows. */
export const PROBE_PORTS: readonly { port: number; kind: string }[] = [
  { port: 8080, kind: 'llama.cpp server' },
  { port: 5001, kind: 'KoboldCpp' },
  { port: 1337, kind: 'Jan' },
  { port: 5000, kind: 'text-generation-webui' },
  { port: 8888, kind: 'Unsloth Studio' },
]

export const probeAddress = (port: number) => `http://127.0.0.1:${port}`

/**
 * What the user typed, as `http(s)://host:port` — or null. A bare word is
 * refused (an AI server always has a port or a dotted name); credentials too.
 */
export function normalizeAddress(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  let u: URL
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`)
  } catch {
    return null
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || !u.hostname) return null
  if (!u.port && !u.hostname.includes('.') && u.hostname !== 'localhost') return null
  return `${u.protocol}//${u.host}`
}

/** A short, stable id for an address (FNV-1a), free of colons so it fits in a writer id. */
export function serverIdOf(address: string): string {
  let h = 0x811c9dc5
  for (const c of address) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193)
  return `s${(h >>> 0).toString(16)}`
}

const KINDS: Record<string, string> = { llamacpp: 'llama.cpp server', koboldcpp: 'KoboldCpp', 'unsloth-studio': 'Unsloth Studio' }

/** `Authorization` for a server that wants a key (Unsloth Studio: `sk-unsloth-…`). */
export const authHeaders = (apiKey?: string): Record<string, string> => (apiKey ? { authorization: `Bearer ${apiKey}` } : {})

export interface ServerModels { kind: string; models: string[]; needsKey?: boolean }

/**
 * The models a server offers, or null when it does not answer. Junk still counts
 * as "there, no models"; a 401/403 is "there, wants a (different) key".
 */
export async function listServerModels(address: string, fetcher: typeof fetch = fetch, timeoutMs = 1500, apiKey?: string):
  Promise<ServerModels | null> {
  let res: Response
  try {
    res = await fetcher(`${address}/v1/models`, { headers: authHeaders(apiKey), signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
  } catch {
    return null
  }
  if (res.status === 401 || res.status === 403) return { kind: 'AI server', models: [], needsKey: true }
  if (!res.ok) return null
  let data: { id?: string; owned_by?: string; loaded?: boolean }[]
  try {
    data = ((await res.json()) as { data?: typeof data }).data ?? []
  } catch {
    return { kind: 'AI server', models: [] }
  }
  // Unsloth lists every model on the PC but answers only with the loaded one —
  // unless its "Model auto-switch" (Settings → API) loads whichever is asked for.
  const unsloth = data[0]?.owned_by === 'unsloth-studio'
  const anyModel = unsloth && await unslothAutoSwitch(address, fetcher, timeoutMs, apiKey)
  const models = data.filter((m) => !unsloth || anyModel || m.loaded).map((m) => m.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  return { kind: KINDS[data[0]?.owned_by ?? ''] ?? 'AI server', models }
}

async function unslothAutoSwitch(address: string, fetcher: typeof fetch, timeoutMs: number, apiKey?: string): Promise<boolean> {
  try {
    const r = await fetcher(`${address}/api/settings/openai-auto-switch`,
      { headers: authHeaders(apiKey), signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
    return r.ok && ((await r.json()) as { enabled?: boolean }).enabled === true
  } catch {
    return false
  }
}

export interface SavedServer { id: string; address: string; apiKey?: string }

/** "Add an address": saved only once it answers (with the key, if given), so the list never fills with typos. */
export async function addServer(input: string, deps: {
  fetcher?: typeof fetch; list: () => SavedServer[]; save: (servers: SavedServer[]) => void; timeoutMs?: number
}, apiKey = ''): Promise<{ server: SavedServer } | { error: string }> {
  const address = normalizeAddress(input)
  if (!address) return { error: 'That doesn’t look like an address. Example: http://127.0.0.1:8080' }
  const key = apiKey.trim()
  const found = await listServerModels(address, deps.fetcher, deps.timeoutMs, key || undefined)
  if (!found) return { error: `Nothing answered at ${address.replace(/^https?:\/\//, '')}. Is the server running?` }
  if (found.needsKey) {
    return { error: key ? 'The server refused that API key. Check it and try again.'
      : 'This server wants an API key. In Unsloth Studio: Settings → API → Create.' }
  }
  const server: SavedServer = key ? { id: serverIdOf(address), address, apiKey: key } : { id: serverIdOf(address), address }
  // Adding a known address again replaces its key (a new or revoked one).
  deps.save([...deps.list().filter((s) => s.address !== address), server])
  return { server }
}
