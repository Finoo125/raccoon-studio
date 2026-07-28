import { describe, it, expect, vi, beforeEach } from 'vitest'

// The start route must refuse to spawn when ANY ComfyUI is already running —
// not just one this app happens to have spawned itself. Mock the server-state
// module so both the "already running" probe and the spawn are observable.
const spawnComfyUI = vi.fn(() => ({ pid: 4242, on: vi.fn() }))
const comfyUIServerPids = vi.fn<() => number[]>(() => [])
const readAlivePid = vi.fn<() => number | null>(() => null)

vi.mock('@/lib/comfyui/server-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/comfyui/server-state')>()
  return {
    ...actual,
    getStartScriptPath: () => 'C:/Raccoon/start-comfyui.ps1',
    spawnComfyUI,
    comfyUIServerPids,
    readAlivePid,
    appendLog: vi.fn(),
    clearLogs: vi.fn(),
    setPhase: vi.fn(),
    getPhase: () => ({ phase: 'starting' as const, message: null, since: 0 }),
    readPid: () => null,
    clearPid: vi.fn(),
  }
})

const { POST } = await import('./route')

beforeEach(() => {
  spawnComfyUI.mockClear()
  comfyUIServerPids.mockReturnValue([])
  readAlivePid.mockReturnValue(null)
})

describe('/api/comfyui-control/start', () => {
  it('starts ComfyUI when nothing is running', async () => {
    const res = await POST()
    expect(res.status).toBe(200)
    expect(spawnComfyUI).toHaveBeenCalledOnce()
  })

  it('refuses when an untracked ComfyUI is already running', async () => {
    // The launcher is the normal way ComfyUI starts, so there is no tracked PID.
    // Spawning a second one costs a ~45s boot that dies on "Port 8188 already in
    // use", and its ComfyUI-Manager prestartup races the running instance's pip
    // installs — which is how onnxruntime ends up a bare namespace package and
    // RaccoonSwapNodes silently loses face swap for the session.
    comfyUIServerPids.mockReturnValue([1234])
    const res = await POST()
    expect(res.status).toBe(409)
    expect(spawnComfyUI).not.toHaveBeenCalled()
    expect(((await res.json()) as { error: string }).error).toMatch(/1234/)
  })

  it('still refuses when only a tracked PID is alive', async () => {
    readAlivePid.mockReturnValue(999)
    const res = await POST()
    expect(res.status).toBe(409)
    expect(spawnComfyUI).not.toHaveBeenCalled()
  })
})
