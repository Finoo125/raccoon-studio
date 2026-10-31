import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getSettings } from '@/lib/settings/settings'
import { getDataDir } from '@/lib/system/paths'
import { KREA2_TEXT_ENCODER } from '@/lib/video/describe'
import { detectGpu, freeGb, runFile, within, type Runner } from '@/lib/hardware'
import { LMS_PORT, lmsCliPath, probeLms, readLmsModels } from './lmstudio'
import { findOllamaExe, isLocalUrl, ollamaExeCandidates, ollamaModelsDir, probeOllama, readOllamaManifests, type Env } from './ollama-local'
import { listServerModels, PROBE_PORTS, probeAddress, serverIdOf, type SavedServer } from './openai-server'
import { tierFor } from './tiers'
import type { ScanResult, ScanServer, WriterModel } from './types'
import { writerIdOf } from './writer-id'

export interface ScanDeps {
  comfyUrl: string
  ollamaUrl: string
  savedServers: SavedServer[]
  platform: NodeJS.Platform
  env: Env
  home: string
  dataDir: string
  /** ComfyUI's models folder (COMFYUI_MODELS_DIR). */
  modelsDir: string
  /** Another install's models the user shares in (settings). */
  sharedModelsDir: string
  fetcher: typeof fetch
  run: Runner
  timeoutMs: number
  /** The port LM Studio was started on, when it is not its default. */
  lmsPort: number
}

function defaults(): ScanDeps {
  const s = getSettings()
  return {
    comfyUrl: s.comfyuiBaseUrl, ollamaUrl: s.ollamaBaseUrl, savedServers: s.aiServers,
    platform: process.platform, env: process.env, home: os.homedir(), dataDir: getDataDir(),
    modelsDir: process.env.COMFYUI_MODELS_DIR ?? '', sharedModelsDir: s.sharedModelsDir,
    fetcher: fetch, run: runFile, timeoutMs: 1500, lmsPort: LMS_PORT,
  }
}

const UNCENSORED = /heretic|abliterat|uncensored/i
const tagsFor = (name: string) => (UNCENSORED.test(name) ? ['Uncensored'] : [])

/** One look at this PC: every AI writer, what state its program is in, and the card it runs on. */
export async function scanWriters(over: Partial<ScanDeps> = {}): Promise<ScanResult> {
  const d = { ...defaults(), ...over }
  const ms = d.timeoutMs
  const fetchJson = async <T>(url: string): Promise<T | null> => {
    try {
      const r = await d.fetcher(url, { signal: AbortSignal.timeout(ms), cache: 'no-store' })
      return r.ok ? ((await r.json()) as T) : null
    } catch {
      return null
    }
  }

  const ollamaDir = ollamaModelsDir(d.env, d.home)
  const [gpu, clip, ollama, lmsUp, found, diskA, diskB] = await Promise.all([
    within(detectGpu(d.comfyUrl, { fetcher: d.fetcher, run: d.run, timeoutMs: ms }), ms + 200, null),
    fetchJson<{ CLIPLoader?: { input?: { required?: { clip_name?: [string[]] } } } }>(`${d.comfyUrl}/object_info/CLIPLoader`),
    probeOllama(d.ollamaUrl, d.fetcher, ms),
    probeLms(d.lmsPort, d.fetcher, ms),
    Promise.all([
      ...d.savedServers.map(async (s) => ({ s, saved: true, r: await listServerModels(s.address, d.fetcher, ms) })),
      ...PROBE_PORTS.filter((p) => !d.savedServers.some((s) => s.address === probeAddress(p.port))).map(async (p) => {
        const address = probeAddress(p.port)
        return { s: { id: serverIdOf(address), address }, saved: false, r: await listServerModels(address, d.fetcher, ms) }
      }),
    ]),
    d.modelsDir ? freeGb(d.modelsDir) : Promise.resolve(null),
    freeGb(ollamaDir),
  ])

  // ComfyUI's own list when it is up; the folders on disk when it is not.
  const clipNames = clip?.CLIPLoader?.input?.required?.clip_name?.[0]
  const onDisk = [d.modelsDir, d.sharedModelsDir, d.sharedModelsDir && path.join(d.sharedModelsDir, 'models')]
    .filter(Boolean).some((dir) => fs.existsSync(path.join(dir as string, 'text_encoders', KREA2_TEXT_ENCODER)))
  const builtinReady = clipNames ? clipNames.includes(KREA2_TEXT_ENCODER) : onDisk

  const ollamaModel = (m: { name: string; sizeGb: number }): WriterModel =>
    ({ id: writerIdOf({ kind: 'ollama', model: m.name }), name: m.name, sizeGb: m.sizeGb, tags: tagsFor(m.name) })
  const local = isLocalUrl(d.ollamaUrl)
  const exe = local ? findOllamaExe(ollamaExeCandidates(d)) : null
  const ollamaState: ScanResult['ollama'] = ollama
    ? { state: 'running', version: ollama.version, canStart: local, models: ollama.models.map(ollamaModel) }
    : exe
      ? { state: 'off', canStart: true, models: readOllamaManifests(ollamaDir).map(ollamaModel) }
      : { state: local ? 'missing' : 'off', canStart: false, models: [] }

  const lmsInstalled = fs.existsSync(lmsCliPath(d.home, d.platform))
  const lmsModels = lmsUp || lmsInstalled
    ? readLmsModels(d.home).map((m): WriterModel => ({ id: writerIdOf({ kind: 'lmstudio', model: m.path }), name: m.name, tags: tagsFor(m.name) }))
    : []

  const servers: ScanServer[] = found
    .filter((f) => f.saved || f.r)
    .map(({ s, saved, r }) => ({
      id: s.id, address: s.address, kind: r?.kind ?? 'AI server', saved, reachable: !!r,
      models: (r?.models ?? []).map((m) => ({ id: writerIdOf({ kind: 'server', server: s.id, model: m }), name: m, tags: tagsFor(m) })),
    }))

  const disks = [[d.modelsDir, diskA], [ollamaDir, diskB]].filter((x): x is [string, number] => !!x[0] && x[1] !== null)
  const low = disks.sort((a, b) => a[1] - b[1])[0]

  return {
    gpu,
    disk: low ? { path: path.parse(path.resolve(low[0])).root, freeGb: low[1] } : null,
    comfyui: clip !== null,
    builtin: { state: builtinReady ? 'ready' : 'missing' },
    ollama: ollamaState,
    lmstudio: { state: lmsUp ? 'running' : lmsInstalled ? 'off' : 'missing', canStart: lmsInstalled, models: lmsModels },
    servers,
    tier: tierFor(gpu?.vramGb ?? null),
  }
}
