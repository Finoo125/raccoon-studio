import { describe, it, expect, afterEach } from 'vitest'
import { spawn, execSync } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs'

// Point the module at a throwaway PID file / logs dir before importing it so
// the tests never clobber a real tracked ComfyUI process or the real app logs.
process.env.COMFYUI_PID_FILE = path.join(os.tmpdir(), `raccoon-test-comfyui-${process.pid}.pid`)
process.env.RACCOON_LOGS_DIR = path.join(os.tmpdir(), `raccoon-test-logs-${process.pid}`)
const state = await import('./server-state')

const pidFile = process.env.COMFYUI_PID_FILE

afterEach(() => {
  try { fs.unlinkSync(pidFile) } catch { /* ignore */ }
})

function groupPids(pgid: number): number[] {
  try {
    return execSync(`ps -o pid= -g ${pgid}`)
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(Number)
  } catch {
    return []
  }
}

// A long-lived child that exists on every platform (sleep/sh are Git-Bash-only
// on Windows): node itself, parked on a timer.
function spawnSleeper() {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { detached: true, stdio: 'ignore' })
  child.unref()
  return child
}

const isWin = process.platform === 'win32'

describe('readAlivePid', () => {
  it('returns the pid while the tracked process is alive', () => {
    const child = spawnSleeper()
    state.writePid(child.pid!)
    expect(state.readAlivePid()).toBe(child.pid)
    // Cleanup: no process groups on Windows, kill the pid directly there.
    process.kill(isWin ? child.pid! : -child.pid!, 'SIGKILL')
  })

  it('clears a stale pid file left by a dead process', async () => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    await new Promise((resolve) => child.on('exit', resolve))
    state.writePid(child.pid!)
    expect(state.readAlivePid()).toBeNull()
    expect(fs.existsSync(pidFile)).toBe(false)
  })
})

describe('stopTrackedProcess', () => {
  it.skipIf(isWin)('kills the whole process group, not just the wrapper shell', async () => {
    // Mirror the start route: a detached shell wrapper whose child is the real
    // long-running process (ComfyUI's python in production). POSIX-only: the
    // win32 branch uses taskkill and is covered by the test below.
    const child = spawn('sh', ['-c', 'sleep 30; sleep 30'], { detached: true, stdio: 'ignore' })
    child.unref()
    state.writePid(child.pid!)
    // Give the shell a moment to fork its child.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(groupPids(child.pid!).length).toBeGreaterThanOrEqual(2)

    const result = await state.stopTrackedProcess()

    expect(result).toEqual({ stopped: true, pid: child.pid })
    expect(groupPids(child.pid!)).toEqual([])
    expect(state.readPid()).toBeNull()
  }, 15_000)

  it.skipIf(!isWin)('stops a tracked process via taskkill on Windows', async () => {
    const child = spawnSleeper()
    state.writePid(child.pid!)
    expect(state.readAlivePid()).toBe(child.pid)

    const result = await state.stopTrackedProcess()

    expect(result).toEqual({ stopped: true, pid: child.pid })
    expect(state.isPidAlive(child.pid!)).toBe(false)
    expect(state.readPid()).toBeNull()
  }, 15_000)

  it('is a no-op success when nothing is tracked', async () => {
    expect(await state.stopTrackedProcess()).toEqual({ stopped: true, pid: null })
  })
})

describe('buildStartCommand', () => {
  it('runs a .ps1 start script through powershell.exe on Windows (not cmd, which would open Notepad)', () => {
    // The Windows installer writes a forward-slashed .ps1 path into .env.local.
    expect(state.buildStartCommand('C:/Raccoon/start-comfyui.ps1', 'win32')).toEqual({
      cmd: 'powershell.exe',
      args: ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', 'C:\\Raccoon\\start-comfyui.ps1'],
    })
  })

  it('runs a .bat/.cmd start script through cmd.exe on Windows', () => {
    expect(state.buildStartCommand('C:/Raccoon/start-comfyui.bat', 'win32')).toEqual({
      cmd: 'cmd.exe',
      args: ['/c', 'C:\\Raccoon\\start-comfyui.bat'],
    })
  })

  it('runs the script directly on POSIX (spawned with shell:true by the caller)', () => {
    expect(state.buildStartCommand('/home/me/start-comfyui.sh', 'linux')).toEqual({
      cmd: '/home/me/start-comfyui.sh',
      args: [],
    })
  })
})

describe('stripAnsi', () => {
  it('removes color codes and carriage returns', () => {
    expect(state.stripAnsi('\u001b[32m[INFO]\u001b[0m Starting server')).toBe('[INFO] Starting server')
    expect(state.stripAnsi('\u001b[2K\rUpdating: comfyui-manager')).toBe('Updating: comfyui-manager')
    expect(state.stripAnsi('plain text')).toBe('plain text')
  })
})

describe('inferLogLevel', () => {
  it('maps ComfyUI terminal markers to levels', () => {
    expect(state.inferLogLevel('[INFO] Starting server')).toBe('info')
    expect(state.inferLogLevel('[WARNING] You need pytorch with cu130')).toBe('warn')
    expect(state.inferLogLevel('[ERROR] Could not load model')).toBe('error')
    expect(state.inferLogLevel('[error] Update failed')).toBe('error')
    expect(state.inferLogLevel('Traceback (most recent call last):')).toBe('error')
    expect(state.inferLogLevel('FETCH ComfyRegistry Data 5/153')).toBe('info')
  })
})

describe('appendLog', () => {
  it('strips ANSI before buffering and mirrors to the persistent log', () => {
    state.clearLogs()
    state.appendLog('\u001b[32m[INFO]\u001b[0m hello from comfyui')
    expect(state.getRecentLogs(1)).toEqual(['[INFO] hello from comfyui'])
    const today = new Date()
    const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const file = path.join(process.env.RACCOON_LOGS_DIR!, `app-${stamp}.log`)
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
    const last = JSON.parse(lines[lines.length - 1]) as { level: string; category: string; message: string }
    expect(last).toMatchObject({ level: 'info', category: 'comfyui-server', message: '[INFO] hello from comfyui' })
  })
})

describe('phase state', () => {
  it('tracks phase transitions with message and timestamp', () => {
    const before = Date.now()
    state.setPhase('updating', null)
    const updating = state.getPhase()
    expect(updating.phase).toBe('updating')
    expect(updating.message).toBeNull()
    expect(updating.since).toBeGreaterThanOrEqual(before)

    state.setPhase('error', 'boom')
    expect(state.getPhase()).toMatchObject({ phase: 'error', message: 'boom' })

    state.setPhase('idle')
    expect(state.getPhase()).toMatchObject({ phase: 'idle', message: null })
  })
})
