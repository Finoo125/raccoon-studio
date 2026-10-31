import { describe, it, expect } from 'vitest'
import { nodeBackend } from './node-backend'

const d = { ollamaBaseUrl: 'http://127.0.0.1:11434', lmsPort: 1234, serverAddress: (id: string) => (id === 's1' ? 'http://127.0.0.1:8080' : null) }

describe('nodeBackend', () => {
  it('maps each writer to the node backend', () => {
    expect(nodeBackend({ kind: 'ollama', model: 'qwen3.5:9b' }, d)).toEqual({ backend: 'Ollama', server_url: 'http://127.0.0.1:11434', remote_model: 'qwen3.5:9b' })
    expect(nodeBackend({ kind: 'lmstudio', model: 'C:/m/x.gguf' }, d)).toEqual({ backend: 'LM Studio (OpenAI-compatible)', server_url: 'http://127.0.0.1:1234', remote_model: 'C:/m/x.gguf' })
    expect(nodeBackend({ kind: 'server', server: 's1', model: 'm' }, d)?.server_url).toBe('http://127.0.0.1:8080')
  })
  it('has none for an unknown server or the built-in writer', () => {
    expect(nodeBackend({ kind: 'server', server: 'gone', model: 'm' }, d)).toBeNull()
    expect(nodeBackend({ kind: 'builtin' }, d)).toBeNull()
  })
})
