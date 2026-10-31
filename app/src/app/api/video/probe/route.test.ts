import { describe, it, expect, vi } from 'vitest'

const probe = vi.fn()
vi.mock('@/lib/movies/ffprobe', () => ({ probeMedia: (u: string) => probe(u) }))
vi.mock('@/lib/settings/settings', () => ({ getSettings: () => ({ comfyuiBaseUrl: 'http://127.0.0.1:8188/' }) }))

const { POST } = await import('./route')
const call = (body: unknown) =>
  POST(new Request('http://x/api/video/probe', { method: 'POST', body: JSON.stringify(body) }) as never)

describe('POST /api/video/probe', () => {
  it('refuses traversal in the filename before anything is spawned', async () => {
    probe.mockClear()
    expect((await call({ filename: '../x.mp4', type: 'input' })).status).toBe(400)
    expect((await call({ filename: 'a.mp4', subfolder: 'v/../..', type: 'output' })).status).toBe(400)
    expect(probe).not.toHaveBeenCalled()
  })
  it("probes ComfyUI's view URL and reports frames", async () => {
    probe.mockResolvedValueOnce({ durationSec: 5.167, videoDurationSec: 5.167, rotation: 0, width: 864, height: 480, hasAudio: false, hasVideo: true })
    const r = await call({ filename: 'a.mp4', subfolder: 'video/x', type: 'output' })
    expect(probe).toHaveBeenLastCalledWith('http://127.0.0.1:8188/view?filename=a.mp4&subfolder=video%2Fx&type=output')
    expect(await r.json()).toEqual({ width: 864, height: 480, durationSec: 5.167, frames: 124, hasAudio: false })
  })
  it('reports a portrait phone clip in DISPLAY orientation, frames off the video stream', async () => {
    probe.mockResolvedValueOnce({ durationSec: 5.2, videoDurationSec: 5.166667, width: 1920, height: 1080, rotation: -90, hasAudio: true, hasVideo: true })
    const r = await (await call({ filename: 'phone.mov', type: 'input' })).json()
    expect([r.width, r.height]).toEqual([1080, 1920])
    expect(r.frames).toBe(124) // not round(5.2 × 24) = 125, which VHS cannot deliver
  })
})
