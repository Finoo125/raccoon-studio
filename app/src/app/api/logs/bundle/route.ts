import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getLogsDir } from '@/lib/system/paths'
import { comboOptions } from '@/lib/models/installed'
import {
  buildSupportBundle,
  formatServerLog,
  tailLines,
  TAIL_LINES,
  type BundleInput,
} from '@/lib/logging/support-bundle'
import pkg from '../../../../../package.json'

/**
 * One downloadable text file describing this install, for support requests.
 * See `lib/logging/support-bundle.ts` for why it is text and what goes in it.
 */

const COMFY_BASE = process.env.COMFYUI_BASE_URL ?? 'http://127.0.0.1:8188'

/** Loader nodes whose file lists have actually explained a support ticket. */
const LOADERS: [node: string, field: string][] = [
  ['CheckpointLoaderSimple', 'ckpt_name'],
  ['UNETLoader', 'unet_name'],
  ['CLIPLoader', 'clip_name'],
  ['VAELoader', 'vae_name'],
  ['LoraLoader', 'lora_name'],
  ['UpscaleModelLoader', 'model_name'],
  ['LatentUpscaleModelLoader', 'model_name'],
  ['ControlNetLoader', 'control_net_name'],
]

/**
 * Config worth reporting, by name. A whitelist rather than a filter over
 * `process.env`: the environment also carries add-on and provider secrets, and
 * a blacklist only protects against the leaks we thought of.
 */
const REPORTED_ENV = [
  'COMFYUI_BASE_URL',
  'COMFYUI_MODELS_DIR',
  'COMFYUI_OUTPUT_DIR',
  'COMFYUI_START_SCRIPT',
  'COMFYUI_DIR',
  'RACCOON_LOGS_DIR',
  'RACCOON_DATA_DIR',
  'OLLAMA_BASE_URL',
  'FFMPEG_PATH',
]

/** Newest file matching `re`, or null. Used to pick the last install log. */
function newestMatching(dir: string, re: RegExp): string | null {
  try {
    const hits = fs
      .readdirSync(dir)
      .filter((f) => re.test(f))
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
    return hits[0]?.f ?? null
  } catch {
    return null
  }
}

function readTail(dir: string, name: string, max: number): string {
  try {
    return tailLines(fs.readFileSync(path.join(dir, name), 'utf8'), max)
  } catch (e) {
    return `  (could not read: ${e instanceof Error ? e.message : String(e)})`
  }
}

async function comfyJson(pathname: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(`${COMFY_BASE}${pathname}`, { signal, cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function GET() {
  const logsDir = getLogsDir()

  // ComfyUI may be down — that is itself a finding, so never fail the bundle
  // over it. Bounded so a hung ComfyUI can't hang the download.
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 10_000)
  const comfyui: BundleInput['comfyui'] = {
    reachable: false,
    baseUrl: COMFY_BASE,
    loadedNodes: [],
    models: {},
  }
  try {
    const [stats, ...loaderInfos] = await Promise.all([
      comfyJson('/system_stats', ac.signal),
      ...LOADERS.map(([node]) => comfyJson(`/object_info/${node}`, ac.signal)),
    ])
    comfyui.reachable = true
    comfyui.systemStats = stats
    LOADERS.forEach(([node, field], i) => {
      comfyui.models[`${node}.${field}`] = comboOptions(loaderInfos[i], node, field)
    })
    // Node *names* only — the full /object_info is megabytes of schema.
    comfyui.loadedNodes = Object.keys((await comfyJson('/object_info', ac.signal)) as object)
    // Best-effort: older ComfyUI has no /internal/logs/raw, and the rest of the
    // bundle is still worth having without it.
    comfyui.serverLog = await comfyJson('/internal/logs/raw', ac.signal)
      .then(formatServerLog)
      .catch(() => undefined)
  } catch (e) {
    comfyui.error = e instanceof Error ? e.message : String(e)
  } finally {
    clearTimeout(timer)
  }

  const logs: Record<string, string> = {
    'comfyui.err': readTail(logsDir, 'comfyui.err', TAIL_LINES['comfyui.err']),
    'comfyui.log': readTail(logsDir, 'comfyui.log', TAIL_LINES['comfyui.log']),
  }
  const install = newestMatching(logsDir, /^install-\d+-\d+\.log$/)
  if (install) logs[install] = readTail(logsDir, install, TAIL_LINES.install)
  const appLog = newestMatching(logsDir, /^app-\d{4}-\d{2}-\d{2}\.log$/)
  if (appLog) logs[appLog] = readTail(logsDir, appLog, TAIL_LINES.app)

  const paths: Record<string, string> = { 'logs dir': logsDir }
  for (const k of REPORTED_ENV) paths[k] = process.env[k] ?? '(not set)'

  const body = buildSupportBundle({
    generatedAt: new Date().toISOString(),
    app: {
      version: (pkg as { version?: string }).version ?? 'unknown',
      platform: `${os.platform()} ${os.release()} (${os.arch()})`,
      node: process.version,
      cpus: String(os.cpus().length),
      'total ram': `${Math.round(os.totalmem() / 1024 ** 3)} GB`,
    },
    paths,
    comfyui,
    logs,
  })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="raccoon-support-${stamp}.txt"`,
      'Cache-Control': 'no-store',
    },
  })
}
