import { readJson, writeJson } from '@/lib/system/json-store'

const FILE = 'settings.json'

export interface AppSettings {
  ollamaBaseUrl: string
  ollamaTimeoutMs: number
  ollamaNumCtx: number
  comfyuiBaseUrl: string
  /** Full path to the ffmpeg binary; empty = use `ffmpeg` from PATH. */
  ffmpegPath: string
}

const num = (v: string | undefined, d: number): number => {
  const n = Number(v)
  return v !== undefined && Number.isFinite(n) ? n : d
}

/** Per field: persisted value → env var → hard default. Re-reads the file each call. */
export function getSettings(): AppSettings {
  const file = readJson<Partial<AppSettings>>(FILE, {})
  return {
    ollamaBaseUrl: file.ollamaBaseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
    ollamaTimeoutMs: file.ollamaTimeoutMs ?? num(process.env.OLLAMA_TIMEOUT_MS, 180000),
    ollamaNumCtx: file.ollamaNumCtx ?? num(process.env.OLLAMA_NUM_CTX, 8192),
    comfyuiBaseUrl: file.comfyuiBaseUrl ?? process.env.COMFYUI_BASE_URL ?? 'http://127.0.0.1:8188',
    ffmpegPath: file.ffmpegPath ?? process.env.FFMPEG_PATH ?? '',
  }
}

/** Merges `patch` over the persisted file (NOT over env-derived values) and saves. */
export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const file = readJson<Partial<AppSettings>>(FILE, {})
  const merged = { ...file, ...patch }
  writeJson(FILE, merged)
  return getSettings()
}
