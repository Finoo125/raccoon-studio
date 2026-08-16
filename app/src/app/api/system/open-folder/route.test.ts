import { describe, it, expect, vi, afterEach } from 'vitest'

// The point of this endpoint is spawning a file manager, so the kiosk guard has
// to be proven by the spawn NOT happening — a 403 with the process still
// started would be exactly the bug.
const spawn = vi.fn(() => ({ unref: vi.fn() }))
vi.mock('child_process', () => ({ spawn }))
vi.mock('@/lib/logging/logger', () => ({ log: vi.fn() }))

const { POST } = await import('./route')

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/system/open-folder', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  // The route only uses .json(), so a plain Request stands in for NextRequest.
  }) as unknown as Parameters<typeof POST>[0])

afterEach(() => {
  delete process.env.RACCOON_KIOSK
  spawn.mockClear()
})

describe('/api/system/open-folder', () => {
  it('refuses on a hosted pod, without spawning anything', async () => {
    process.env.RACCOON_KIOSK = '1'
    const res = await post({ path: 'C:/anywhere' })
    expect(res.status).toBe(403)
    expect(spawn).not.toHaveBeenCalled()
    expect((await res.json()).error).toMatch(/hosted pod/i)
  })

  // The desktop app is the normal case and must be untouched by the flag: it
  // gets as far as the path validation rather than being turned away at the
  // door. Note the path check ALSO answers 403, so the status alone proves
  // nothing here — the reason is what separates the two.
  it('does not refuse when the flag is absent', async () => {
    const res = await post({ path: 'C:/definitely/not/allowed' })
    expect((await res.json()).error).toMatch(/not inside an allowed directory/i)
  })

  it('treats any value other than 1 as a desktop install', async () => {
    process.env.RACCOON_KIOSK = '0'
    const res = await post({ path: 'C:/definitely/not/allowed' })
    expect((await res.json()).error).not.toMatch(/hosted pod/i)
  })
})
