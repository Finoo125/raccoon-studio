import { afterEach, describe, expect, it, vi } from 'vitest'
import { engineRendering, restartComfyUI, waitForEngine } from './restart'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

afterEach(() => vi.unstubAllGlobals())

describe('waitForEngine', () => {
  it('resolves once the engine answers, after it was down', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++
      if (calls < 3) throw new Error('down')
      return new Response('{}', { status: 200 })
    }))
    await expect(waitForEngine(1000, 1)).resolves.toBeUndefined()
    expect(calls).toBe(3)
  })
  it('gives up with words a person can act on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })))
    await expect(waitForEngine(20, 1)).rejects.toThrow(/press Start/)
  })
})

describe('restartComfyUI', () => {
  it('says false and never starts when the stop fails', async () => {
    const f = vi.fn(async () => new Response('{"error":"busy"}', { status: 500 }))
    vi.stubGlobal('fetch', f)
    await expect(restartComfyUI()).resolves.toBe(false)
    expect(f).toHaveBeenCalledTimes(1)
    expect(f).not.toHaveBeenCalledWith('/api/comfyui-control/start', expect.anything())
  })
  it('says false when it stopped but would not start', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => new Response('{}', { status: u.endsWith('/start') ? 500 : 200 })))
    await expect(restartComfyUI()).resolves.toBe(false)
  })
  it('says true after a stop and a start', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    await expect(restartComfyUI()).resolves.toBe(true)
  })
})

describe('engineRendering', () => {
  const queue = (running: number, pending: number) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      queue_running: Array(running).fill([]), queue_pending: Array(pending).fill([]),
    }), { status: 200 })))
  it("reads ComfyUI's own queue: running or pending is a render to protect", async () => {
    queue(1, 0)
    await expect(engineRendering()).resolves.toBe(true)
    queue(0, 2)
    await expect(engineRendering()).resolves.toBe(true)
    queue(0, 0)
    await expect(engineRendering()).resolves.toBe(false)
  })
  it('a dead or unreachable engine has nothing to protect', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"ComfyUI unreachable"}', { status: 502 })))
    await expect(engineRendering()).resolves.toBe(false)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    await expect(engineRendering()).resolves.toBe(false)
  })
})
