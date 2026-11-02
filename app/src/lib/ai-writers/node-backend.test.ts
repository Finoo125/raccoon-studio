import { describe, it, expect } from 'vitest'
import { nodeBackend } from './node-backend'

const d = { ollamaBaseUrl: 'http://127.0.0.1:11434', lmsPort: 1234,
  server: (id: string) => (id === 's1' ? { address: 'http://127.0.0.1:8080' } : id === 'su' ? { address: 'http://127.0.0.1:8888', apiKey: 'sk-unsloth-x' } : null) }

describe('nodeBackend', () => {
  it('maps each writer to the node backend', () => {
    expect(nodeBackend({ kind: 'ollama', model: 'qwen3.5:9b' }, d)).toEqual({ backend: 'Ollama', server_url: 'http://127.0.0.1:11434', remote_model: 'qwen3.5:9b', api_key: '' })
    expect(nodeBackend({ kind: 'lmstudio', model: 'C:/m/x.gguf' }, d)).toEqual({ backend: 'LM Studio (OpenAI-compatible)', server_url: 'http://127.0.0.1:1234', remote_model: 'C:/m/x.gguf', api_key: '' })
    expect(nodeBackend({ kind: 'server', server: 's1', model: 'm' }, d)).toMatchObject({ server_url: 'http://127.0.0.1:8080', api_key: '' })
    expect(nodeBackend({ kind: 'server', server: 'su', model: 'm' }, d)).toMatchObject({ server_url: 'http://127.0.0.1:8888', api_key: 'sk-unsloth-x' })
  })
  it('has none for an unknown server or the built-in writer', () => {
    expect(nodeBackend({ kind: 'server', server: 'gone', model: 'm' }, d)).toBeNull()
    expect(nodeBackend({ kind: 'builtin' }, d)).toBeNull()
  })
})
