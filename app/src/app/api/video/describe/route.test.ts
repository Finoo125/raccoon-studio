import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST } from './route'

afterEach(() => vi.unstubAllGlobals())
const req = (body: unknown) => new Request('http://x/api/video/describe', { method: 'POST', body: JSON.stringify(body) }) as never

describe('POST /api/video/describe', () => {
  it('fetches the picture from ComfyUI and asks the chosen model about it', async () => {
    const calls: { url: string; body?: string }[] = []
    vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body })
      if (url.includes('/view?')) return { ok: true, arrayBuffer: async () => new TextEncoder().encode('ABC').buffer }
      return { ok: true, json: async () => ({ message: { content: 'A woman with silver hair.' } }) }
    })
    const res = await POST(req({ filename: 'me.png', role: 'character', model: 'qwen3.5:27b' }))
    expect(await res.json()).toEqual({ text: 'A woman with silver hair.' })
    expect(calls[0].url).toMatch(/\/view\?filename=me\.png&subfolder=&type=input/)
    const chat = JSON.parse(calls[1].body!)
    expect(chat.model).toBe('qwen3.5:27b')
    expect(chat.messages[0].images).toEqual([Buffer.from('ABC').toString('base64')])
  })
  it('reads a subfolder picture from its own folder, and refuses a non-string name', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url)
      if (url.includes('/view?')) return { ok: true, arrayBuffer: async () => new TextEncoder().encode('A').buffer }
      return { ok: true, json: async () => ({ message: { content: 'A thing.' } }) }
    })
    await POST(req({ filename: 'sub/x.png', role: 'prop', model: 'm' }))
    expect(urls[0]).toMatch(/filename=x\.png&subfolder=sub&type=input/)
    expect((await POST(req({ filename: 42, role: 'prop', model: 'm' }))).status).toBe(400)
  })
  it('refuses traversal and a missing model', async () => {
    expect((await POST(req({ filename: '../x.png', role: 'character', model: 'm' }))).status).toBe(400)
    expect((await POST(req({ filename: 'me.png', role: 'character' }))).status).toBe(400)
  })
})
