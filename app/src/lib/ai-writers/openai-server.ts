/** Where llama.cpp-style servers listen by default. LM Studio and Ollama have their own rows. */
export const PROBE_PORTS: readonly { port: number; kind: string }[] = [
  { port: 8080, kind: 'llama.cpp server' },
  { port: 5001, kind: 'KoboldCpp' },
  { port: 1337, kind: 'Jan' },
  { port: 5000, kind: 'text-generation-webui' },
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

const KINDS: Record<string, string> = { llamacpp: 'llama.cpp server', koboldcpp: 'KoboldCpp' }

/** The models a server offers, or null when it does not answer. Junk still counts as "there, no models". */
export async function listServerModels(address: string, fetcher: typeof fetch = fetch, timeoutMs = 1500):
  Promise<{ kind: string; models: string[] } | null> {
  let res: Response
  try {
    res = await fetcher(`${address}/v1/models`, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
  } catch {
    return null
  }
  if (!res.ok) return null
  try {
    const data = ((await res.json()) as { data?: { id?: string; owned_by?: string }[] }).data ?? []
    const models = data.map((m) => m.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
    return { kind: KINDS[data[0]?.owned_by ?? ''] ?? 'AI server', models }
  } catch {
    return { kind: 'AI server', models: [] }
  }
}

export interface SavedServer { id: string; address: string }

/** "Add an address": saved only once it answers, so the list never fills with typos. */
export async function addServer(input: string, deps: {
  fetcher?: typeof fetch; list: () => SavedServer[]; save: (servers: SavedServer[]) => void; timeoutMs?: number
}): Promise<{ server: SavedServer } | { error: string }> {
  const address = normalizeAddress(input)
  if (!address) return { error: 'That doesn’t look like an address. Example: http://127.0.0.1:8080' }
  const found = await listServerModels(address, deps.fetcher, deps.timeoutMs)
  if (!found) return { error: `Nothing answered at ${address.replace(/^https?:\/\//, '')}. Is the server running?` }
  const server = { id: serverIdOf(address), address }
  const list = deps.list()
  if (!list.some((s) => s.address === address)) deps.save([...list, server])
  return { server }
}
