import type { Tier } from './tiers'

export type AppState = 'running' | 'off' | 'missing'

export interface WriterModel {
  /** The full writer id (see writer-id.ts). */
  id: string
  name: string
  sizeGb?: number
  tags: string[]
}

export interface ScanServer {
  id: string
  address: string
  kind: string
  /** The user added it; the others were found on the usual ports. */
  saved: boolean
  reachable: boolean
  /** It answered 401/403: it wants an API key, or refused the saved one. */
  needsKey: boolean
  models: WriterModel[]
}

/** Everything the AI writer setup shows, from one scan of this PC. */
export interface ScanResult {
  gpu: { name: string; vramGb: number } | null
  /** The drive downloads land on. */
  disk: { path: string; freeGb: number } | null
  /** The built-in writer runs inside ComfyUI. */
  comfyui: boolean
  builtin: { state: 'ready' | 'missing' }
  ollama: { state: AppState; version?: string; canStart: boolean; models: WriterModel[] }
  lmstudio: { state: AppState; canStart: boolean; models: WriterModel[] }
  servers: ScanServer[]
  tier: Tier
}
