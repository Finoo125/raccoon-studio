import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/comfyui/server-state', () => ({ getComfyUIBase: () => 'http://127.0.0.1:8188' }))
const unlocked = vi.fn<(id: string) => Promise<boolean>>()
vi.mock('@/lib/addons/entitlement', () => ({ isFeatureUnlocked: (id: string) => unlocked(id) }))
vi.mock('@/lib/logging/logger', () => ({ log: vi.fn() }))

const upstream = vi.fn<typeof fetch>()
vi.stubGlobal('fetch', upstream)

const { GET, POST, PATCH } = await import('./route')

const get = (headers: Record<string, string> = {}) =>
  GET(new NextRequest('http://localhost:3000/api/comfyui/view?filename=a.mp4&type=output', { headers }), {
    params: Promise.resolve({ path: ['view'] }),
  })

const bytes = (n: number) => new Uint8Array(Array.from({ length: n }, (_, i) => i & 255))

beforeEach(() => upstream.mockReset())

// ComfyUI's /view is an aiohttp FileResponse: it answers Range with 206 and
// advertises Accept-Ranges. The proxy used to drop the Range on the way up and
// every header but Content-Type on the way back, so Chromium saw 200 + chunked
// with no Accept-Ranges and treated every clip as non-seekable — a
// `currentTime` set past 0 fires `seeked` with the clip still at 0.000.
describe('GET /api/comfyui/[...path] — byte ranges', () => {
  it('forwards a Range request and returns the partial response as-is', async () => {
    const body = bytes(100)
    upstream.mockResolvedValue(new Response(body, {
      status: 206,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': 'bytes 0-99/1819881',
        'Content-Length': '100',
        'Accept-Ranges': 'bytes',
      },
    }))
    const res = await get({ range: 'bytes=0-99' })

    const init = upstream.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('range')).toBe('bytes=0-99')
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 0-99/1819881')
    expect(res.headers.get('content-length')).toBe('100')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(body)
  })

  it('advertises the size and byte ranges on a whole-file response', async () => {
    upstream.mockResolvedValue(new Response(bytes(10), {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Content-Length': '10', 'Accept-Ranges': 'bytes' },
    }))
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('content-length')).toBe('10')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
  })

  // ComfyUI 403s any Origin that is not its own host, and a browser cookie has
  // no business on the ComfyUI side. Only the range headers travel up.
  it('sends nothing else from the browser upstream', async () => {
    upstream.mockResolvedValue(new Response(bytes(1), { status: 200 }))
    await get({ range: 'bytes=0-0', 'if-range': '"etag"', origin: 'http://localhost:3000', cookie: 'x=1' })
    const sent = new Headers((upstream.mock.calls[0][1] as RequestInit).headers)
    expect(sent.get('range')).toBe('bytes=0-0')
    expect(sent.get('if-range')).toBe('"etag"')
    expect(sent.get('origin')).toBeNull()
    expect(sent.get('cookie')).toBeNull()
  })

  // fetch decodes a compressed body transparently, so the upstream length
  // would describe bytes the client never receives.
  it('drops Content-Length when the upstream body was compressed', async () => {
    upstream.mockResolvedValue(new Response(bytes(10), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Content-Length': '999', 'Content-Encoding': 'gzip' },
    }))
    const res = await get()
    expect(res.headers.get('content-length')).toBeNull()
    expect(res.headers.get('content-encoding')).toBeNull()
  })
})

describe('POST/PATCH /api/comfyui/[...path] - video writer lock', () => {
  const send = (fn: typeof POST, path: string[], text = '{"video_mode":"t2v"}') =>
    fn(new NextRequest(`http://localhost:3000/api/comfyui/${path.join('/')}`, { method: fn === PATCH ? 'PATCH' : 'POST', body: text }), {
      params: Promise.resolve({ path }),
    })
  beforeEach(() => unlocked.mockReset())

  it('refuses a locked writer stream without calling upstream', async () => {
    unlocked.mockResolvedValue(false)
    const res = await send(POST, ['rvn', 'generate_stream'])
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Feature locked', feature: 'prompt-builder' })
    expect(upstream).not.toHaveBeenCalled()
  })
  it('refuses a path variant and PATCH too', async () => {
    unlocked.mockResolvedValue(false)
    expect((await send(PATCH, ['rvn', '..', 'rvn', 'generate_stream'])).status).toBe(403)
    expect(upstream).not.toHaveBeenCalled()
  })
  it('forwards the exact body when unlocked', async () => {
    unlocked.mockResolvedValue(true)
    upstream.mockResolvedValue(new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
    const res = await send(POST, ['rvn', 'generate_stream'], '{"video_mode":"i2v","x":1}')
    expect(res.status).toBe(200)
    expect(new TextDecoder().decode((upstream.mock.calls[0][1] as RequestInit).body as ArrayBuffer)).toBe('{"video_mode":"i2v","x":1}')
  })
  it('forwards other paths without an entitlement lookup', async () => {
    upstream.mockResolvedValue(new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
    const res = await send(POST, ['prompt'], '{"a":1}')
    expect(res.status).toBe(200)
    expect(unlocked).not.toHaveBeenCalled()
    expect(upstream).toHaveBeenCalledTimes(1)
  })
})
