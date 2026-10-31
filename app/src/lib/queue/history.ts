import { readJson, writeJson } from '@/lib/system/json-store'

const FILE = 'queue-history.json'
const MAX_HISTORY = 200

export interface JobRecord {
  id: string
  promptId: string
  kind: 'image' | 'video'
  workflowId: string
  workflowName: string
  prompt: string
  generationParams: unknown
  status: 'done' | 'error' | 'cancelled'
  createdAt: number
  /**
   * When the render actually began, as distinct from when it was queued.
   * Persisted because the video panel's cost estimate learns its seconds-per-
   * unit rate from finished renders, and without this it could only ever learn
   * from renders made since the page was last loaded - i.e. never, on the fresh
   * load that is every load.
   */
  startedAt?: number
  endedAt?: number
  outputImages: string[]
  outputVideos?: string[]
  error?: string
}

export function readHistory(): JobRecord[] {
  return readJson<JobRecord[]>(FILE, [])
}

export function appendHistory(rec: JobRecord): JobRecord[] {
  const without = readHistory().filter((r) => r.id !== rec.id)
  const next = [rec, ...without].slice(0, MAX_HISTORY)
  writeJson(FILE, next)
  return next
}

export function removeHistory(id: string): JobRecord[] {
  const next = readHistory().filter((r) => r.id !== id)
  writeJson(FILE, next)
  return next
}

export function clearCompletedHistory(): JobRecord[] {
  writeJson(FILE, [])
  return []
}
