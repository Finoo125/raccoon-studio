import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { POST as startComfyRoute } from '@/app/api/comfyui-control/start/route'
import { getTransfer, startTransfer } from '@/lib/models/transfers'
import { buildMessages } from '@/lib/prompt-builder/enhance'
import { cleanModelText } from '@/lib/prompts/clean-model-text'
import { getSettings } from '@/lib/settings/settings'
import { getDataDir } from '@/lib/system/paths'
import { freeGb } from '@/lib/hardware'
import { findOllamaExe, ollamaExeCandidates, ollamaModelsDir } from './ollama-local'
import type { SetupDeps } from './setup-jobs'
import { ensureRunning, startApp } from './start'
import { writeWith } from './write'
import { parseWriterId } from './writer-id'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const exeCandidates = () => ollamaExeCandidates({ platform: process.platform, env: process.env, home: os.homedir(), dataDir: getDataDir() })

/** A download through the app's transfer engine (stall watchdog, redirects, .tmp then rename), awaited. */
async function download(spec: { url: string; dir: string; name: string; root?: string }, progress: (d: number, t: number) => void): Promise<string> {
  const { transfer, error } = startTransfer({ url: spec.url, path: spec.dir, name: spec.name, root: spec.root })
  if (!transfer) throw new Error(error)
  for (;;) {
    const t = getTransfer(transfer.key) ?? transfer
    progress(t.receivedBytes / 1e9, t.totalBytes / 1e9)
    if (t.status === 'done') break
    if (t.status !== 'running') throw new Error(t.error ?? t.status)
    await sleep(500)
  }
  const root = spec.root ?? process.env.COMFYUI_MODELS_DIR ?? ''
  return path.join(root, spec.dir, path.basename(spec.name))
}

async function comfyUp(): Promise<boolean> {
  try {
    return (await fetch(`${getSettings().comfyuiBaseUrl}/system_stats`, { signal: AbortSignal.timeout(2000), cache: 'no-store' })).ok
  } catch {
    return false
  }
}

/** The same start the top bar's button does, then wait for ComfyUI to answer (a cold boot takes a minute or two). */
async function startComfy(): Promise<void> {
  const res = await startComfyRoute()
  if (!res.ok && res.status !== 409) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'start failed')
  for (const deadline = Date.now() + 240_000; Date.now() < deadline; await sleep(2000)) {
    if (await comfyUp()) return
  }
  throw new Error('ComfyUI did not come online')
}

/**
 * Windows: Ollama's own installer, silently (Inno Setup, per user, no admin —
 * its ollama.iss says PrivilegesRequired=lowest). It starts Ollama afterwards.
 * Linux: unpack the package into the app's data folder — the official script
 * needs sudo, this does not.
 */
async function installOllama(file: string): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(file, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { windowsHide: true })
      const timer = setTimeout(() => { child.kill(); reject(new Error('installer timed out')) }, 10 * 60_000)
      child.on('error', (e) => { clearTimeout(timer); reject(e) })
      child.on('exit', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`installer exit code ${code}`)) })
    })
    if (!findOllamaExe(exeCandidates())) throw new Error('ollama.exe not found after install')
    return
  }
  const dest = path.join(getDataDir(), 'tools', 'ollama')
  fs.mkdirSync(dest, { recursive: true })
  // Node 22.15+ can undo zstd itself; older Node leaves it to tar (which needs zstd installed).
  const zstd = (zlib as unknown as { createZstdDecompress?: () => NodeJS.ReadWriteStream }).createZstdDecompress
  await new Promise<void>((resolve, reject) => {
    const tar = zstd
      ? spawn('tar', ['-x', '-C', dest], { stdio: ['pipe', 'ignore', 'ignore'] })
      : spawn('tar', ['--zstd', '-xf', file, '-C', dest], { stdio: ['ignore', 'ignore', 'ignore'] })
    tar.on('error', reject)
    tar.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exit code ${code}`))))
    // tar dying mid-unpack (a full disk) breaks the pipe: an EPIPE with no listener would crash the server.
    tar.stdin?.on('error', reject)
    if (zstd) fs.createReadStream(file).on('error', reject).pipe(zstd()).on('error', reject).pipe(tar.stdin!)
  })
  if (!fs.existsSync(path.join(dest, 'bin', 'ollama'))) throw new Error('bin/ollama missing after unpack')
}

/** `POST /api/pull`, streamed: progress is the sum over the model's layers. */
async function pull(model: string, progress: (d: number, t: number) => void): Promise<void> {
  const res = await fetch(`${getSettings().ollamaBaseUrl}/api/pull`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true }),
  })
  if (!res.ok || !res.body) throw new Error(`pull ${res.status}`)
  const layers = new Map<string, { total: number; completed: number }>()
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let success = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const m = JSON.parse(line) as { status?: string; digest?: string; total?: number; completed?: number; error?: string }
      if (m.error) throw new Error(m.error)
      if (m.digest && m.total) layers.set(m.digest, { total: m.total, completed: m.completed ?? 0 })
      const all = [...layers.values()]
      progress(all.reduce((s, l) => s + l.completed, 0) / 1e9, all.reduce((s, l) => s + l.total, 0) / 1e9)
      if (m.status === 'success') success = true
    }
  }
  if (!success) throw new Error('pull ended early')
}

/** One real description from the new writer, so "ready" is proven, not assumed. */
async function testWrite(writerId: string): Promise<{ sample: string; seconds: number }> {
  const t0 = Date.now()
  await ensureRunning(parseWriterId(writerId)!)
  const raw = await writeWith(writerId, buildMessages('write', 'sentences', '', 'a cat dressed as a knight in a castle'))
  const sample = cleanModelText(raw)
  if (!sample) throw new Error('The writer returned nothing usable — try again')
  return { sample, seconds: Math.round((Date.now() - t0) / 100) / 10 }
}

export function realSetupDeps(): SetupDeps {
  return {
    platform: process.platform,
    arch: process.arch,
    freeGb,
    download,
    comfyUp,
    startComfy,
    ollamaInstalled: () => findOllamaExe(exeCandidates()) !== null,
    installOllama,
    startOllama: () => startApp('ollama'),
    pull,
    testWrite,
    removeFile: (f) => fs.rmSync(f, { force: true }),
    modelsDir: process.env.COMFYUI_MODELS_DIR ?? '',
    ollamaModelsDir: ollamaModelsDir(process.env, os.homedir()),
    downloadsRoot: getDataDir(),
  }
}
