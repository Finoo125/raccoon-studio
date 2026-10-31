import { spawn, type StdioOptions } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getSettings } from '@/lib/settings/settings'
import { getDataDir, getLogsDir } from '@/lib/system/paths'
import { runFile } from '@/lib/hardware'
import { currentLmsPort, lmsCliPath, probeLms, rememberLmsPort } from './lmstudio'
import { findOllamaExe, isLocalUrl, ollamaExeCandidates } from './ollama-local'
import type { WriterRef } from './writer-id'

export type StartableApp = 'ollama' | 'lmstudio'

export interface StartDeps {
  /** Only an Ollama on this PC is ever started. */
  ollamaLocal: boolean
  probe: (app: StartableApp) => Promise<boolean>
  launch: (app: StartableApp) => Promise<void>
  waitMs: number
  pollMs: number
}

const FAILED: Record<StartableApp, string> = {
  ollama: 'Ollama didn’t start. Open it from the Start menu, or choose another writer.',
  lmstudio: 'LM Studio didn’t start. Open it, or choose another writer.',
}

/** One start per app at a time: three parallel writes, or a double click, share it. */
const inFlight: Map<StartableApp, Promise<void>> =
  ((globalThis as unknown as { __raccoonAppStarts?: Map<StartableApp, Promise<void>> }).__raccoonAppStarts ??= new Map())

/** Starts a switched-off Ollama or LM Studio and waits until it answers; throws plain words if it never does. */
export function startApp(app: StartableApp, over: Partial<StartDeps> = {}): Promise<void> {
  const running = inFlight.get(app)
  if (running) return running
  const d = { ...defaults(), ...over }
  const job = (async () => {
    // Already up (the Windows installer starts Ollama itself, or the scan was stale): launch nothing.
    if (await d.probe(app)) return
    try {
      await d.launch(app)
    } catch {
      throw new Error(FAILED[app])
    }
    const deadline = Date.now() + d.waitMs
    while (Date.now() < deadline) {
      if (await d.probe(app)) return
      await new Promise((r) => setTimeout(r, d.pollMs))
    }
    throw new Error(FAILED[app])
  })().finally(() => inFlight.delete(app))
  inFlight.set(app, job)
  return job
}

/** "Starts by itself when used": called once before a write. */
export async function ensureRunning(ref: WriterRef, over: Partial<StartDeps> = {}): Promise<void> {
  if (ref.kind !== 'ollama' && ref.kind !== 'lmstudio') return
  const d = { ...defaults(), ...over }
  if (ref.kind === 'ollama' && !d.ollamaLocal) return
  if (await d.probe(ref.kind)) return
  await startApp(ref.kind, d)
}

function defaults(): StartDeps {
  const url = getSettings().ollamaBaseUrl
  return {
    ollamaLocal: isLocalUrl(url),
    probe: (app) => (app === 'ollama' ? ollamaAnswers(url) : probeLms(currentLmsPort())),
    launch: (app) => (app === 'ollama' ? launchOllama(url) : launchLms()),
    waitMs: 60_000,
    pollMs: 500,
  }
}

async function ollamaAnswers(url: string): Promise<boolean> {
  try {
    return (await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(1500), cache: 'no-store' })).ok
  } catch {
    return false
  }
}

/**
 * Windows: Ollama's own tray app, as a normal install starts it (it runs the
 * server and keeps itself updated). Elsewhere, or without the tray app:
 * `ollama serve`, detached, logging into the app's logs folder.
 */
export async function launchOllama(baseUrl: string): Promise<void> {
  const exe = findOllamaExe(ollamaExeCandidates({ platform: process.platform, env: process.env, home: os.homedir(), dataDir: getDataDir() }))
  if (!exe) throw new Error('Ollama isn’t installed. Set it up in AI writer setup.')
  const u = new URL(baseUrl)
  const env = { ...process.env, OLLAMA_HOST: `${u.hostname}:${u.port || '11434'}` }
  const tray = path.join(path.dirname(exe), 'ollama app.exe')
  if (process.platform === 'win32' && fs.existsSync(tray)) {
    spawnDetached(tray, [], { env })
    return
  }
  fs.mkdirSync(getLogsDir(), { recursive: true })
  const log = fs.openSync(path.join(getLogsDir(), 'ollama.log'), 'a')
  spawnDetached(exe, ['serve'], { stdio: ['ignore', log, log], env })
}

/**
 * Starts a program that outlives the request. A child process without an
 * 'error' listener that fails to start (missing file, no permission) throws
 * from an event and takes the whole app server down with it; here it only
 * means the start never answers, which startApp reports in plain words.
 */
export function spawnDetached(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; stdio?: StdioOptions } = {}): void {
  const child = spawn(cmd, args, { detached: true, stdio: opts.stdio ?? 'ignore', windowsHide: true, env: opts.env ?? process.env })
  child.on('error', (err) => console.error(`[ai-writers] could not start ${cmd}: ${err.message}`))
  child.unref()
}

/** `lms server start` — it prints the port it took, which later writes need. */
export async function launchLms(): Promise<void> {
  const out = await runFile(lmsCliPath(os.homedir(), process.platform), ['server', 'start'], 60_000)
  const port = Number(out.match(/port (\d+)/i)?.[1])
  if (port) rememberLmsPort(port)
}
