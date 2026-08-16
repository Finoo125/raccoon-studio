import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// A hosted pod's reverse proxy kills any connection that sends nothing for
// ~125 s, and this stream can legitimately go quiet for longer than that:
// progress fires once per whole percent, and 1% of a 42 GB model set is 420 MB.
// The heartbeat is the only thing keeping a big download alive, and it is
// invisible in normal use — exactly the kind of code that rots silently.

// A request that connects, sends headers, then never sends a byte: the case the
// heartbeat exists for.
const silentResponse = Object.assign(new EventEmitter(), {
  statusCode: 200,
  headers: { 'content-length': '999999999' },
  pipe: vi.fn(),
})
// Signature matters: the route calls get(url, options, callback), so a
// two-arg mock hands the options object to cb() and the whole stream errors
// out before the heartbeat can prove anything.
const https = {
  get: vi.fn((_url: unknown, _opts: unknown, cb: (r: unknown) => void) => { cb(silentResponse); return new EventEmitter() }),
}

vi.mock('https', () => ({ default: https, ...https }))
// The destination must NOT exist, or the route answers `done` before it ever
// opens a connection — and the heartbeat never starts.
const existsSync = (p: unknown) => !String(p).includes('big.safetensors')
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  const patched = { ...actual, existsSync, mkdirSync: vi.fn(), createWriteStream: () => new EventEmitter() }
  return { ...patched, default: patched }
})
vi.mock('@/lib/logging/logger', () => ({ log: vi.fn() }))

process.env.COMFYUI_MODELS_DIR = process.platform === 'win32' ? 'C:/models' : '/models'
const { POST } = await import('./route')

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('/api/models/download heartbeat', () => {
  it('sends an SSE comment every 15s while the download is silent', async () => {
    const res = await POST(new Request('http://localhost/api/models/download', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/big.safetensors', path: 'checkpoints', name: 'big.safetensors' }),
    }) as unknown as Parameters<typeof POST>[0])

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()

    await vi.advanceTimersByTimeAsync(16_000)
    const first = decoder.decode((await reader.read()).value)
    expect(first).toBe(': ping\n\n')

    await vi.advanceTimersByTimeAsync(15_000)
    expect(decoder.decode((await reader.read()).value)).toBe(': ping\n\n')

    void reader.cancel()
  })

  // The client parser skips anything that is not a `data: ` line, and EventSource
  // ignores comments outright — so the heartbeat must stay a comment. A stray
  // `data:` here would reach the UI as an event with no type.
  it('keeps the heartbeat a comment, never a data frame', async () => {
    const res = await POST(new Request('http://localhost/api/models/download', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/big.safetensors', path: 'checkpoints', name: 'big.safetensors' }),
    }) as unknown as Parameters<typeof POST>[0])
    const reader = res.body!.getReader()
    await vi.advanceTimersByTimeAsync(16_000)
    const chunk = new TextDecoder().decode((await reader.read()).value)
    expect(chunk.startsWith(':')).toBe(true)
    expect(chunk).not.toMatch(/^data:/)
    void reader.cancel()
  })
})
