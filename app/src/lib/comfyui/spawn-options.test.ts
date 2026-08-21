import { describe, it, expect } from 'vitest'
import os from 'os'
import path from 'path'

process.env.COMFYUI_PID_FILE ??= path.join(os.tmpdir(), `raccoon-test-spawn-${process.pid}.pid`)
process.env.RACCOON_LOGS_DIR ??= path.join(os.tmpdir(), `raccoon-test-spawn-logs-${process.pid}`)
const { comfyUISpawnOptions } = await import('./server-state')

describe('comfyUISpawnOptions', () => {
  it('never detaches on Windows', () => {
    // The expensive one. `detached` there means DETACHED_PROCESS: powershell.exe
    // gets no console and exits 0 in ~100ms WITHOUT running the start script —
    // no output, no error, just a clean exit that reads as "the script did
    // nothing". ComfyUI simply never came up, and nothing said why.
    expect(comfyUISpawnOptions('win32').detached).toBe(false)
  })

  it('detaches on POSIX, where stopTrackedProcess signals the process group', () => {
    expect(comfyUISpawnOptions('linux').detached).toBe(true)
    expect(comfyUISpawnOptions('darwin').detached).toBe(true)
  })

  // buildStartCommand names the interpreter, so a shell would add nothing but a
  // word-splitting step that breaks any install path containing a space.
  it('never uses a shell, on any platform', () => {
    expect(comfyUISpawnOptions('win32').shell).toBe(false)
    expect(comfyUISpawnOptions('linux').shell).toBe(false)
    expect(comfyUISpawnOptions('darwin').shell).toBe(false)
  })

  it('pipes stdout/stderr so the boot log can capture them', () => {
    expect(comfyUISpawnOptions('win32').stdio).toEqual(['ignore', 'pipe', 'pipe'])
  })
})
