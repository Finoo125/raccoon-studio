import { describe, it, expect, beforeEach, vi } from 'vitest'
import os from 'os'
import path from 'path'

process.env.COMFYUI_PID_FILE ??= path.join(os.tmpdir(), `raccoon-test-port-${process.pid}.pid`)
process.env.RACCOON_LOGS_DIR ??= path.join(os.tmpdir(), `raccoon-test-port-logs-${process.pid}`)

// comfyuiBaseUrl is editable in Settings and its port is interpolated into a
// shell command, so getComfyUIPort is a trust boundary — drive it through the
// settings layer the same way production does.
const getSettings = vi.hoisted(() => vi.fn())
vi.mock('@/lib/settings/settings', () => ({ getSettings }))

const { getComfyUIPort } = await import('./server-state')

const withBase = (comfyuiBaseUrl: string) => {
  getSettings.mockReturnValue({ comfyuiBaseUrl })
  return getComfyUIPort()
}

describe('getComfyUIPort', () => {
  beforeEach(() => getSettings.mockReset())

  it('reads an explicit port', () => {
    expect(withBase('http://localhost:8188')).toBe(8188)
    expect(withBase('http://192.168.1.50:9999')).toBe(9999)
  })

  it('falls back to 8188 when the URL omits the port', () => {
    expect(withBase('http://comfy.local')).toBe(8188)
  })

  it('refuses a port outside the valid range', () => {
    expect(withBase('http://localhost:0')).toBeNull()
    expect(withBase('http://localhost:70000')).toBeNull()
  })

  it('refuses a base URL that is not a URL at all', () => {
    expect(withBase('not a url')).toBeNull()
    expect(withBase('')).toBeNull()
  })

  it('never yields anything but digits — the value reaches a shell', () => {
    // A crafted authority must not smuggle a command through the port slot.
    for (const base of [
      'http://localhost:8188;calc.exe',
      'http://localhost:$(whoami)',
      'http://localhost:8188 && rm -rf /',
    ]) {
      const port = withBase(base)
      if (port !== null) expect(String(port)).toMatch(/^\d+$/)
    }
  })
})
