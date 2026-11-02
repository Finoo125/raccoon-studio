import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ai-writers/start', () => ({ ensureRunning: vi.fn(async () => {}) }))
vi.mock('@/lib/comfyui/server-state', () => ({ getComfyUIBase: () => 'http://comfy:8188' }))
vi.mock('@/lib/settings/settings', () => ({ getSettings: () => ({ ollamaBaseUrl: 'http://127.0.0.1:11434', aiServers: [] }) }))

import { ensureRunning } from '@/lib/ai-writers/start'
import { writerErrorMessage } from '@/lib/ai-writers/errors'
import { POST } from './route'

const call = (body: unknown) =>
  POST(new Request('http://localhost/api/video/writer-backend', { method: 'POST', body: JSON.stringify(body) }))
const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(ensureRunning).mockReset().mockResolvedValue(undefined)
})

describe('POST /api/video/writer-backend', () => {
  it('asks for a writer', async () => {
    const res = await call({ engine: '' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Pick a writer first.')
  })

  it('refuses the built-in writer', async () => {
    const res = await call({ engine: 'builtin' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('The built-in writer can’t write video scripts. Pick another writer.')
  })

  it('says why a switched-off writer failed', async () => {
    const err = new Error('boom')
    vi.mocked(ensureRunning).mockRejectedValueOnce(err)
    const res = await call({ engine: 'ollama:m' })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe(writerErrorMessage(err, { kind: 'ollama', model: 'm' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('points the node at the writer', async () => {
    const res = await call({ engine: 'ollama:qwen3.5:9b' })
    expect(res.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://comfy:8188/rvn/set_backend')
    expect(JSON.parse(init.body)).toEqual({ backend: 'Ollama', server_url: 'http://127.0.0.1:11434', remote_model: 'qwen3.5:9b', api_key: '' })
  })

  it('treats a bare Ollama model name as Ollama (old saved forms)', async () => {
    const res = await call({ engine: 'qwen3.8-heretic:latest' })
    expect(res.status).toBe(200)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).remote_model).toBe('qwen3.8-heretic:latest')
  })

  it('reports a node that refuses', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    expect((await call({ engine: 'ollama:m' })).status).toBe(502)
  })
})
