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
