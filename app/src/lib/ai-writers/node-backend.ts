import type { WriterRef } from './writer-id'

export interface NodeBackend {
  backend: 'Ollama' | 'LM Studio (OpenAI-compatible)'
  server_url: string
  remote_model: string
}

/**
 * What the video node's /rvn/set_backend needs to talk to the picked writer.
 * The built-in writer is a ComfyUI job, not a server the node can call, and a
 * server id that is no longer listed has no address: both give null.
 */
export function nodeBackend(
  ref: WriterRef,
  d: { ollamaBaseUrl: string; lmsPort: number; serverAddress: (id: string) => string | null },
): NodeBackend | null {
  switch (ref.kind) {
    case 'ollama': return { backend: 'Ollama', server_url: d.ollamaBaseUrl, remote_model: ref.model }
    case 'lmstudio': return { backend: 'LM Studio (OpenAI-compatible)', server_url: `http://127.0.0.1:${d.lmsPort}`, remote_model: ref.model }
    case 'server': {
      const address = d.serverAddress(ref.server)
      return address ? { backend: 'LM Studio (OpenAI-compatible)', server_url: address, remote_model: ref.model } : null
    }
    default: return null
  }
}
