import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { setSettings } from '@/lib/settings/settings'
import { buildStoryboardMessages, parseStoryboard, chatStoryboard, listOllamaModels } from './ollama'

describe('buildStoryboardMessages', () => {
  it('produces a system + user message asking for N beats and the plot', () => {
    const msgs = buildStoryboardMessages('a hero rises', 4, 'anima')
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    expect(msgs[1].role).toBe('user')
    expect(msgs[0].content).toContain('4')
    expect(msgs[1].content).toContain('a hero rises')
    expect(msgs[0].content.toLowerCase()).toContain('continu')
  })

  it('tunes the style hint to the image model', () => {
    const anime = buildStoryboardMessages('p', 2, 'anima')[0].content.toLowerCase()
    const real = buildStoryboardMessages('p', 2, 'z-image-turbo')[0].content.toLowerCase()
    expect(anime).toContain('anime')
    expect(real).toContain('photoreal')
  })
})

describe('parseStoryboard', () => {
  const valid = JSON.stringify({
    openingImagePrompt: 'a wide city shot',
    negativePrompt: 'blurry',
    beats: ['b1', 'b2'],
  })

  it('parses clean JSON', () => {
    expect(parseStoryboard(valid)).toEqual({
      openingImagePrompt: 'a wide city shot',
      negativePrompt: 'blurry',
      beats: ['b1', 'b2'],
    })
  })

  it('strips ```json code fences', () => {
    const fenced = '```json\n' + valid + '\n```'
    expect(parseStoryboard(fenced).beats).toEqual(['b1', 'b2'])
  })

  it('omits negativePrompt when absent and coerces beats to strings', () => {
    const r = parseStoryboard(JSON.stringify({
      openingImagePrompt: 'x',
      beats: ['only'],
    }))
    expect(r.negativePrompt).toBeUndefined()
    expect(r.beats).toEqual(['only'])
  })

  it('throws on non-JSON', () => {
    expect(() => parseStoryboard('I cannot do that')).toThrow()
  })

  it('throws when required fields are missing', () => {
    expect(() => parseStoryboard(JSON.stringify({ beats: [] }))).toThrow()
    expect(() => parseStoryboard(JSON.stringify({ openingImagePrompt: 'x' }))).toThrow()
    expect(() => parseStoryboard(JSON.stringify({ openingImagePrompt: 'x', beats: [] }))).toThrow()
  })
})

describe('chatStoryboard timeout', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('aborts with a clear, actionable error when Ollama does not respond in time', async () => {
    // A fetch that never resolves on its own — it only settles when the
    // AbortSignal fires (mirroring a slow model that produces nothing).
    vi.stubGlobal('fetch', (_url: string, init: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      }))
    await expect(chatStoryboard('slow-model', [], 20)).rejects.toThrow(/within|too slow|faster/i)
  })
})

describe('chatStoryboard GPU fit', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('requests a bounded num_ctx so the model fits in VRAM instead of spilling to CPU', async () => {
    let body: { options?: { num_ctx?: number } } = {}
    vi.stubGlobal('fetch', (_url: string, init: { body: string }) => {
      body = JSON.parse(init.body)
      return Promise.resolve({
        ok: true,
        json: async () => ({ message: { content: '{}' } }),
      } as Response)
    })
    await chatStoryboard('m', [], 5000)
    expect(body.options?.num_ctx).toBeGreaterThan(0)
  })
})

describe('chatStoryboard VRAM release', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('asks Ollama to unload the model immediately after responding (keep_alive 0)', async () => {
    let body: { keep_alive?: number } = {}
    vi.stubGlobal('fetch', (_url: string, init: { body: string }) => {
      body = JSON.parse(init.body)
      return Promise.resolve({
        ok: true,
        json: async () => ({ message: { content: '{}' } }),
      } as Response)
    })
    await chatStoryboard('m', [], 5000)
    expect(body.keep_alive).toBe(0)
  })
})

describe('ollama uses settings base url', () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-oll-'))
    process.env.RACCOON_DATA_DIR = tmp
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
    delete process.env.RACCOON_DATA_DIR
    vi.restoreAllMocks()
  })

  it('fetches the settings base url for /api/tags', async () => {
    setSettings({ ollamaBaseUrl: 'http://configured:11434' })
    const spy = vi.fn(async () => ({ ok: true, json: async () => ({ models: [] }) }))
    vi.stubGlobal('fetch', spy as unknown as typeof fetch)
    await listOllamaModels().catch(() => {})
    // `vi.fn(async () => …)` infers an empty `[]` arg tuple, so cast the recorded
    // calls to read the first arg (the fetched URL).
    const calls = spy.mock.calls as unknown as unknown[][]
    expect(String(calls[0]?.[0])).toContain('http://configured:11434')
  })
})
