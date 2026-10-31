import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TEST_IDEA } from '@/lib/ai-writers/test-idea'

vi.mock('@/lib/addons/guard', () => ({ assertEntitled: vi.fn(async () => null) }))
vi.mock('@/lib/director/ollama', () => ({ chatText: vi.fn(), listOllamaVisionModels: vi.fn(async () => ['llava:7b']) }))
vi.mock('@/lib/ai-writers/start', () => ({ ensureRunning: vi.fn(async () => {}) }))
vi.mock('@/lib/prompt-builder/writer', async (orig) => ({
  ...(await orig<typeof import('@/lib/prompt-builder/writer')>()),
  runBuiltinWriter: vi.fn(),
}))

import { assertEntitled } from '@/lib/addons/guard'
import { chatText, listOllamaVisionModels } from '@/lib/director/ollama'
import { runBuiltinWriter, WriterTimeout } from '@/lib/prompt-builder/writer'
import { ensureRunning } from '@/lib/ai-writers/start'
import { POST } from './route'

const call = (body: unknown) =>
  POST(new Request('http://localhost/api/prompt-builder/generate', { method: 'POST', body: JSON.stringify(body) }))
const ok = { task: 'write', idea: 'a fox', prompt: '', workflowId: 'krea2-turbo', engine: 'builtin' }

beforeEach(() => {
  vi.mocked(runBuiltinWriter).mockReset().mockResolvedValue('<think>x</think>A red fox in fresh snow')
  vi.mocked(chatText).mockReset().mockResolvedValue('A red fox')
  vi.mocked(ensureRunning).mockReset().mockResolvedValue(undefined)
  // Nothing in here may reach the network: Ollama's /api/show and LM Studio answer from this stub.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
})

describe('POST /api/prompt-builder/generate edit task', () => {
  const edit = { task: 'edit', idea: 'make her jacket red', prompt: '', editKind: 'vfx', engine: 'ollama:llava:7b', frameB64: 'AAAA' }
  it('needs no workflow and shows a vision model the frame', async () => {
    const res = await call(edit)
    expect(await res.json()).toEqual({ prompts: ['A red fox'], sees: true })
    expect(vi.mocked(chatText).mock.calls[0][1].at(-1)).toMatchObject({ images: ['AAAA'] })
  })
  it('withholds the frame from a model that cannot see', async () => {
    const res = await call({ ...edit, engine: 'ollama:qwen3:8b' })
    expect((await res.json()).sees).toBe(false)
    expect(vi.mocked(chatText).mock.calls[0][1].at(-1)!.images).toBeUndefined()
  })
  it('starts the writer before asking which models see (a cold Ollama lists none)', async () => {
    let started = false
    vi.mocked(ensureRunning).mockImplementationOnce(async () => { started = true })
    vi.mocked(listOllamaVisionModels).mockImplementationOnce(async () => (started ? ['llava:7b'] : []))
    const res = await call(edit)
    expect((await res.json()).sees).toBe(true)
    expect(vi.mocked(chatText).mock.calls[0][1].at(-1)).toMatchObject({ images: ['AAAA'] })
  })
  it('refuses the built-in writer', async () => {
    const res = await call({ ...edit, engine: 'builtin' })
    expect(res.status).toBe(400)
    expect(vi.mocked(runBuiltinWriter)).not.toHaveBeenCalled()
  })
  it('drops an echo of the prompt', async () => {
    vi.mocked(chatText).mockResolvedValue('same words')
    expect((await call({ ...edit, prompt: 'same words' })).status).toBe(502)
  })
  it('drops a version that runs on, keeps the rest', async () => {
    vi.mocked(chatText).mockResolvedValueOnce('Change her jacket to red; keep her face and the café.')
      .mockResolvedValueOnce('Change her jacket to red; keep ' + 'abs obliques pectorals deltoids '.repeat(40))
    expect((await (await call({ ...edit, count: 2 })).json()).prompts).toEqual(['Change her jacket to red; keep her face and the café.'])
  })
  it('rejects an unknown kind', async () => {
    expect((await call({ ...edit, editKind: 'zzz' })).status).toBe(400)
  })
})

describe('POST /api/prompt-builder/generate', () => {
  it('is gated by the add-on', async () => {
    vi.mocked(assertEntitled).mockResolvedValueOnce(new Response('{}', { status: 403 }))
    expect((await call(ok)).status).toBe(403)
  })

  describe('test write', () => {
    const locked = () => new Response('{}', { status: 403 })
    const only = (...ids: string[]) =>
      vi.mocked(assertEntitled).mockImplementation(async (id) => (ids.includes(id) ? null : locked()))
    afterEach(() => { vi.mocked(assertEntitled).mockReset().mockResolvedValue(null) })
    const test = { test: true, workflowId: 'krea2-turbo', engine: 'builtin', idea: 'my own idea', prompt: 'p', count: 3 }

    it('is refused when both add-ons are locked', async () => {
      only()
      expect((await call(test)).status).toBe(403)
    })
    it('passes for a Director-only owner and writes the fixed idea, once', async () => {
      only('ltx-director')
      expect((await call(test)).status).toBe(200)
      expect(vi.mocked(runBuiltinWriter)).toHaveBeenCalledTimes(1)
      const [messages] = vi.mocked(runBuiltinWriter).mock.calls[0]
      expect(JSON.stringify(messages)).toContain(TEST_IDEA)
      expect(JSON.stringify(messages)).not.toContain('my own idea')
    })
    it('does not open the writer to a Director-only owner without the flag', async () => {
      only('ltx-director')
      expect((await call({ ...test, test: false })).status).toBe(403)
      expect(vi.mocked(runBuiltinWriter)).not.toHaveBeenCalled()
    })
    it('leaves a prompt-builder owner as before', async () => {
      only('prompt-builder')
      expect((await call({ ...ok, count: 1 })).status).toBe(200)
      await call(test)
      expect(JSON.stringify(vi.mocked(runBuiltinWriter).mock.calls.at(-1)![0])).toContain(TEST_IDEA)
    })
  })

  it.each([
    [{ ...ok, task: 'nope' }],
    [{ ...ok, workflowId: 'nope' }],
    [{ ...ok, idea: '  ' }],
    [{ ...ok, task: 'improve', prompt: ' ' }],
    [{ ...ok, engine: '' }],
    [{ ...ok, engine: 'ollama:' }],
    [{ ...ok, engine: 'chatgpt:4o' }],
  ])('rejects bad input %#', async (body) => {
    expect((await call(body)).status).toBe(400)
  })

  it('runs the built-in writer and cleans its answer', async () => {
    const res = await call(ok)
    expect(await res.json()).toEqual({ prompts: ['A red fox in fresh snow'] })
    const [messages] = vi.mocked(runBuiltinWriter).mock.calls[0]
    expect(messages[0].content).toMatch(/paragraph/)
  })

  it('runs Ollama with the chosen model', async () => {
    await call({ ...ok, engine: 'ollama:qwen3:8b' })
    expect(vi.mocked(chatText).mock.calls[0][0]).toBe('qwen3:8b')
  })

  it('writes tags for a tag preset and puts a lost quality prefix back', async () => {
    vi.mocked(runBuiltinWriter).mockResolvedValue('1girl, solo, beach')
    const prefix = 'score_9, score_8_up, score_7_up, score_6_up, '
    const res = await call({ ...ok, workflowId: 'pony', prompt: prefix })
    expect((await res.json()).prompts[0]).toBe('score_9, score_8_up, score_7_up, score_6_up, 1girl, solo, beach')
    expect(vi.mocked(runBuiltinWriter).mock.calls[0][0][0].content).toMatch(/Danbooru/)
  })

  it("keeps Z-Image's prompt under its limit", async () => {
    vi.mocked(runBuiltinWriter).mockResolvedValue(Array(120).fill('word').join(', '))
    const res = await call({ ...ok, workflowId: 'z-image-turbo' })
    const out = (await res.json()).prompts[0] as string
    expect(out.length).toBeLessThanOrEqual(400)
    expect(vi.mocked(runBuiltinWriter).mock.calls[0][0][0].content).toMatch(/under 400 characters/)
  })

  it('504s when the writer times out', async () => {
    vi.mocked(runBuiltinWriter).mockRejectedValue(new WriterTimeout('Still busy rendering — try again in a moment'))
    const res = await call(ok)
    expect(res.status).toBe(504)
    expect((await res.json()).error).toMatch(/busy rendering/)
  })

  it('explains a missing text model and a stopped ComfyUI in plain words', async () => {
    vi.mocked(runBuiltinWriter).mockRejectedValueOnce(new Error('ComfyUI /prompt → 400: value_not_in_list clip_name'))
    expect((await (await call(ok)).json()).error).toMatch(/isn’t downloaded yet/)
    vi.mocked(runBuiltinWriter).mockRejectedValueOnce(new TypeError('fetch failed'))
    expect((await (await call(ok)).json()).error).toMatch(/ComfyUI is not running/)
  })

  it('tidies a runaway tag answer', async () => {
    vi.mocked(runBuiltinWriter).mockResolvedValue('1girl, beach, no_clouds, beach, ' + Array.from({ length: 80 }, (_, i) => `t${i}`).join(', '))
    const out = (await (await call({ ...ok, workflowId: 'illustrious', task: 'improve', prompt: '1girl, beach' })).json()).prompts[0] as string
    expect(out).not.toMatch(/no_clouds/)
    expect(out.split(', ').length).toBeLessThanOrEqual(40)
  })

  // Live 2026-10-10: the writer turned __color__ into _crimson_ despite being told to keep it.
  it('leaves the prompt alone when the writer drops a wildcard', async () => {
    vi.mocked(runBuiltinWriter).mockResolvedValue('a woman in a crimson dress on a beach')
    const res = await call({ ...ok, task: 'improve', prompt: 'a woman in a __color__ dress' })
    expect(res.status).toBe(422)
    const { error } = await res.json()
    expect(error).toMatch(/__color__/)
    expect(error).not.toMatch(/try again/)
  })

  it('keeps an answer that kept every wildcard', async () => {
    vi.mocked(runBuiltinWriter).mockResolvedValue('a woman in a flowing __color__ dress on a beach')
    const res = await call({ ...ok, task: 'improve', prompt: 'a woman in a __color__ dress' })
    expect((await res.json()).prompts[0]).toBe('a woman in a flowing __color__ dress on a beach')
  })

  it.each([['__hair-color__'], ['{red|blue}']])('leaves the prompt alone when the writer drops %s', async (w) => {
    vi.mocked(runBuiltinWriter).mockResolvedValue('a woman in a crimson dress')
    const res = await call({ ...ok, task: 'improve', prompt: `a woman in a ${w} dress` })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain(w)
  })

  it("keeps the user's own no_ tags and never doubles a half-kept prefix", async () => {
    vi.mocked(runBuiltinWriter).mockResolvedValue('score_9, score_8_up, 1girl, no_shoes, beach')
    const prefix = 'score_9, score_8_up, score_7_up, score_6_up, '
    const res = await call({ ...ok, workflowId: 'pony', task: 'improve', prompt: prefix + '1girl, no_shoes' })
    expect((await res.json()).prompts[0]).toBe('score_9, score_8_up, score_7_up, score_6_up, 1girl, no_shoes, beach')
  })

  it('blames Ollama, not ComfyUI, when Ollama is down', async () => {
    vi.mocked(chatText).mockRejectedValueOnce(new TypeError('fetch failed'))
    const { error } = await (await call({ ...ok, engine: 'ollama:qwen3' })).json()
    expect(error).toMatch(/Ollama is not running/)
  })

  it('writes up to three versions, each its own call', async () => {
    vi.mocked(runBuiltinWriter)
      .mockResolvedValueOnce('A red fox in snow')
      .mockResolvedValueOnce('A red fox at dawn')
      .mockResolvedValueOnce('A red fox at dusk')
    const res = await call({ ...ok, count: 3 })
    expect((await res.json()).prompts).toEqual(['A red fox in snow', 'A red fox at dawn', 'A red fox at dusk'])
    expect(runBuiltinWriter).toHaveBeenCalledTimes(3)
  })

  it('drops failed, junk and duplicate versions but keeps the rest', async () => {
    vi.mocked(runBuiltinWriter)
      .mockRejectedValueOnce(new Error('CUDA out of memory'))
      .mockResolvedValueOnce("I'm sorry, I can't help with that.")
      .mockResolvedValueOnce('A red fox at dawn')
    expect((await (await call({ ...ok, count: 3 })).json()).prompts).toEqual(['A red fox at dawn'])
    vi.mocked(runBuiltinWriter).mockResolvedValue('Same fox')
    expect((await (await call({ ...ok, count: 3 })).json()).prompts).toEqual(['Same fox'])
  })

  it('keeps only the versions that kept every wildcard', async () => {
    vi.mocked(runBuiltinWriter)
      .mockResolvedValueOnce('a woman in a crimson dress')
      .mockResolvedValueOnce('a woman in a flowing __color__ dress')
    const res = await call({ ...ok, task: 'improve', prompt: 'a woman in a __color__ dress', count: 2 })
    expect((await res.json()).prompts).toEqual(['a woman in a flowing __color__ dress'])
  })

  it('clamps count to 1..3', async () => {
    await call({ ...ok, count: 9 })
    expect(runBuiltinWriter).toHaveBeenCalledTimes(3)
  })

  it('502s on an empty or refused answer', async () => {
    vi.mocked(runBuiltinWriter).mockResolvedValue("I'm sorry, I can't help with that.")
    expect((await call(ok)).status).toBe(502)
  })

  // Live 2026-10-10: an LM Studio prompt-enhancer model handed the description back verbatim, three times —
  // the dialog then changed nothing and said nothing.
  it('says so when the writer only hands the description back', async () => {
    const mine = 'A lighthouse on a cliff in a storm, lightning overhead.'
    vi.mocked(runBuiltinWriter).mockResolvedValue(mine)
    const res = await call({ ...ok, prompt: mine, count: 3 })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('The writer gave your description back unchanged. Try again, or pick another writer.')
  })

  it('drops the versions that only repeat the description and keeps the new ones', async () => {
    const mine = 'A lighthouse on a cliff in a storm.'
    vi.mocked(runBuiltinWriter).mockResolvedValueOnce(mine).mockResolvedValueOnce('A stone lighthouse in a raging storm at night')
    const res = await call({ ...ok, prompt: mine, count: 2 })
    expect((await res.json()).prompts).toEqual(['A stone lighthouse in a raging storm at night'])
  })

  it('never contacts a server it does not know', async () => {
    const res = await call({ ...ok, engine: 'server:sunknown:m' })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('That AI server isn’t in the list any more. Scan again.')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('starts a switched-off app once, then writes three versions', async () => {
    await call({ ...ok, engine: 'ollama:qwen3:8b', count: 3 })
    expect(ensureRunning).toHaveBeenCalledTimes(1)
    expect(ensureRunning).toHaveBeenCalledWith({ kind: 'ollama', model: 'qwen3:8b' })
    expect(chatText).toHaveBeenCalledTimes(3)
  })

  it('answers in plain words when the app does not start', async () => {
    vi.mocked(ensureRunning).mockRejectedValueOnce(new Error('LM Studio didn’t start. Open it, or choose another writer.'))
    const res = await call({ ...ok, engine: 'lmstudio:S/pe/pe.gguf' })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('LM Studio didn’t start. Open it, or choose another writer.')
  })

  it('writes through LM Studio with the model path', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ choices: [{ message: { content: 'A red fox in LM Studio' } }] }))
    const res = await call({ ...ok, engine: 'lmstudio:S/pe/pe.gguf' })
    expect((await res.json()).prompts).toEqual(['A red fox in LM Studio'])
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:1234/v1/chat/completions')
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'S/pe/pe.gguf', ttl: 5 })
  })
})
