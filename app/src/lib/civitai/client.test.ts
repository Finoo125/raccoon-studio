import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { searchModels, getModel, folderForType, downloadUrlFor } from './client'
import { stillImages } from './types'
import { writeAuth } from './oauth'

/** Shape captured from a real response, trimmed to the fields we consume. */
const FIXTURE = {
  items: [{
    id: 2856467,
    name: '[MMH3] Mystic XXX',
    description: '<p>Unlock real anatomy.</p>',
    type: 'LORA',
    nsfw: true,
    creator: { username: 'alcaitiff' },
    stats: { downloadCount: 1234, thumbsUpCount: 56 },
    modelVersions: [{
      id: 3266628,
      name: 'v4.0',
      baseModel: 'MiniMax H3',
      publishedAt: '2026-08-25T20:06:20.322Z',
      files: [{ name: 'MysticXXX_MMH3-V4.safetensors', sizeKB: 151461.5, type: 'Model' }],
      images: [{ url: 'https://image.civitai.com/abc/width=450/x.jpeg' }],
      downloadUrl: 'https://civitai.com/api/download/models/3266628',
    }],
  }],
  metadata: { nextCursor: '2' },
}

let tmp: string
let urls: string[]

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-civitai-cl-'))
  process.env.RACCOON_DATA_DIR = tmp
  writeAuth({ accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3_600_000 })
  urls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(String(url))
    return new Response(JSON.stringify(FIXTURE), { status: 200 })
  }))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
  delete process.env.RACCOON_DATA_DIR
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('searchModels', () => {
  it('ALWAYS sends nsfw=true', async () => {
    // Measured: without it, model 2856467 is absent from a search for its own
    // name on BOTH civitai.com and civitai.red. Dropping this silently turns the
    // browser into a SFW-only search, which reads as a bug rather than a filter.
    await searchModels({ query: 'mystic xxx' })
    expect(urls[0]).toContain('nsfw=true')
  })

  it('passes query, type, sort and cursor through', async () => {
    await searchModels({ query: 'mystic', types: 'LORA', sort: 'Most Downloaded', cursor: '7' })
    const p = new URL(urls[0]).searchParams
    expect(p.get('query')).toBe('mystic')
    expect(p.get('types')).toBe('LORA')
    expect(p.get('sort')).toBe('Most Downloaded')
    expect(p.get('cursor')).toBe('7')
  })

  it('omits parameters that were not supplied', async () => {
    await searchModels({})
    const p = new URL(urls[0]).searchParams
    expect(p.has('query')).toBe(false)
    expect(p.has('cursor')).toBe(false)
  })

  it('lifts nextCursor out of metadata', async () => {
    const r = await searchModels({ query: 'mystic' })
    expect(r.nextCursor).toBe('2')
    expect(r.items[0].name).toBe('[MMH3] Mystic XXX')
  })

  it('keeps a complete body that arrives with a 503', async () => {
    // Caught live 2026-08-28 during a real Civitai wobble: their search answers
    // 503 while returning items and nextCursor intact. Throwing on the status
    // alone discarded results the user could have had and read as "search is
    // broken", which is a different claim from "Civitai is degraded".
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify(FIXTURE), { status: 503 })))

    const r = await searchModels({ query: 'mystic' })
    expect(r.items).toHaveLength(1)
    expect(r.nextCursor).toBe('2')
  })

  it('still throws when a failure carries no items', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 })))

    await expect(searchModels({ query: 'mystic' })).rejects.toThrow(/429/)
  })
})

describe('stillImages', () => {
  const VID = 'https://image.civitai.com/abc/uuid/original=true/4058376.mp4'

  it('asks the CDN for a still frame instead of dropping a video preview', () => {
    // Verified live: the same path with `anim=false,width=450` answers
    // image/jpeg (102 KB) where `original=true` answers video/webm (922 KB).
    const [out] = stillImages([{ url: VID, type: 'video' }])
    expect(out.url).toBe('https://image.civitai.com/abc/uuid/anim=false,width=450/4058376.mp4')
  })

  it('leaves ordinary images untouched', () => {
    const imgs = [{ url: 'https://image.civitai.com/a/b/width=450/x.jpeg', type: 'image' as const }]
    expect(stillImages(imgs)).toEqual(imgs)
  })

  it('keeps a converted video in position, so thumbnails do not reshuffle', () => {
    const out = stillImages([{ url: VID, type: 'video' }, { url: 'b.jpeg', type: 'image' }])
    expect(out).toHaveLength(2)
    expect(out[1].url).toBe('b.jpeg')
  })

  it('drops a video whose URL has no transform segment to rewrite', () => {
    // Nothing to swap means no still can be requested, and an <img> would just
    // render an empty tile.
    expect(stillImages([{ url: 'https://x/y.mp4', type: 'video' }])).toEqual([])
  })

  it('keeps an entry with no type rather than hiding it', () => {
    expect(stillImages([{ url: 'c.jpeg' }])).toHaveLength(1)
  })
})

describe('getModel', () => {
  /** The detail endpoint returns a bare model, not a `{ items: [...] }` page —
   *  the shared fixture is a search response and would not survive the id check. */
  const stubModel = () => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(String(url))
    return new Response(JSON.stringify(FIXTURE.items[0]), { status: 200 })
  }))

  it('requests the model by id', async () => {
    stubModel()
    const m = await getModel(2856467)
    expect(urls[0]).toContain('/models/2856467')
    expect(m.id).toBe(2856467)
  })

  it('rejects a response that is not a model, whatever its status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: 'nope' }), { status: 200 })))
    await expect(getModel(1)).rejects.toThrow(/could not load model 1/i)
  })
})

describe('folderForType', () => {
  it('routes adapters and checkpoints to the folders ComfyUI reads', () => {
    expect(folderForType('LORA')).toBe('loras')
    expect(folderForType('LoCon')).toBe('loras')
    expect(folderForType('DoRA')).toBe('loras')
    expect(folderForType('Checkpoint')).toBe('checkpoints')
  })

  it('defaults an unknown type to checkpoints', () => {
    expect(folderForType('Wildcards')).toBe('checkpoints')
  })
})

describe('downloadUrlFor', () => {
  it('puts the token in the query, not a header', () => {
    // Measured: the download 302s to a presigned R2 URL, and an Authorization
    // header on THAT host is a 400 ("only one auth mechanism allowed"). The
    // redirect builds a fresh URL, so a query token never reaches R2. curl hides
    // this by stripping auth across hosts; Node's http, which startTransfer
    // uses, does not.
    const u = new URL(downloadUrlFor(3266628, 'TOK'))
    expect(u.origin).toBe('https://civitai.com')
    expect(u.pathname).toBe('/api/download/models/3266628')
    expect(u.searchParams.get('token')).toBe('TOK')
  })

  it('escapes a token that would otherwise break the query', () => {
    expect(new URL(downloadUrlFor(1, 'a&b=c')).searchParams.get('token')).toBe('a&b=c')
  })
})
