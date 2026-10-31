/**
 * One string names a writer everywhere — in the browser's memory, the dropdown
 * and the generate request. A server writer carries only its id, never its
 * address: the route looks the address up, so a request cannot aim the app at
 * a host of its choosing.
 */
export type WriterRef =
  | { kind: 'builtin' }
  | { kind: 'ollama'; model: string }
  | { kind: 'lmstudio'; model: string }
  | { kind: 'server'; server: string; model: string }

export function parseWriterId(id: string): WriterRef | null {
  if (id === 'builtin') return { kind: 'builtin' }
  const i = id.indexOf(':')
  if (i < 0) return null
  const kind = id.slice(0, i)
  const rest = id.slice(i + 1)
  if (kind === 'ollama' || kind === 'lmstudio') return rest.trim() ? { kind, model: rest } : null
  if (kind !== 'server') return null
  // Model names keep their colons (Ollama tags, hf.co paths); the server id has none.
  const j = rest.indexOf(':')
  const model = rest.slice(j + 1)
  return j > 0 && model.trim() ? { kind, server: rest.slice(0, j), model } : null
}

export function writerIdOf(ref: WriterRef): string {
  switch (ref.kind) {
    case 'builtin': return 'builtin'
    case 'server': return `server:${ref.server}:${ref.model}`
    default: return `${ref.kind}:${ref.model}`
  }
}
