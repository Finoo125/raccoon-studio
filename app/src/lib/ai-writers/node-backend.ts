import type { WriterRef } from './writer-id'

export interface NodeBackend {
  backend: 'Ollama' | 'LM Studio (OpenAI-compatible)'
  server_url: string
  remote_model: string
  /** Always sent, so switching away from a keyed server clears its key in the node. */
  api_key: string
}

/**
 * What the video node's /rvn/set_backend needs to talk to the picked writer.
 * The built-in writer is a ComfyUI job, not a server the node can call, and a
 * server id that is no longer listed has no address: both give null.
 */
export function nodeBackend(
  ref: WriterRef,
  d: { ollamaBaseUrl: string; lmsPort: number; server: (id: string) => { address: string; apiKey?: string } | null },
): NodeBackend | null {
  switch (ref.kind) {
    case 'ollama': return { backend: 'Ollama', server_url: d.ollamaBaseUrl, remote_model: ref.model, api_key: '' }
    case 'lmstudio': return { backend: 'LM Studio (OpenAI-compatible)', server_url: `http://127.0.0.1:${d.lmsPort}`, remote_model: ref.model, api_key: '' }
    case 'server': {
      const s = d.server(ref.server)
      return s ? { backend: 'LM Studio (OpenAI-compatible)', server_url: s.address, remote_model: ref.model, api_key: s.apiKey ?? '' } : null
    }
    default: return null
  }
}
