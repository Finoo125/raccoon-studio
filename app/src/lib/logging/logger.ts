import fs from 'fs'
import path from 'path'
import { getLogsDir } from '@/lib/system/paths'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogCategory =
  | 'comfyui'        // proxied traffic to the ComfyUI instance
  | 'comfyui-server' // ComfyUI's own terminal output (boot, updates, generation)
  | 'generation'     // prompt submissions / job lifecycle
  | 'status'         // health/detect/queue polling
  | 'nextjs'         // the Next.js app itself
  | 'system'         // OS-level actions (open folder, scripts)
  | 'gallery'        // gallery scans

export interface LogEntry {
  ts: string
  level: LogLevel
  category: string
  message: string
  meta?: Record<string, unknown>
}

const RETENTION_DAYS = 7
const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function dateStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function logFileFor(d: Date): string {
  return path.join(getLogsDir(), `app-${dateStamp(d)}.log`)
}

function ensureDir(): string {
  const dir = getLogsDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

let _cleanedAt = 0

/** Delete app log files older than the retention window. Throttled to hourly. */
function cleanupOldLogs() {
  const now = Date.now()
  if (now - _cleanedAt < 3_600_000) return
  _cleanedAt = now
  try {
    const dir = getLogsDir()
    const cutoff = now - RETENTION_DAYS * 86_400_000
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^app-(\d{4})-(\d{2})-(\d{2})\.log$/)
      if (!m) continue
      const fileTime = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
      if (fileTime < cutoff) {
        try { fs.unlinkSync(path.join(dir, f)) } catch { /* ignore */ }
      }
    }
  } catch { /* logs dir not readable yet */ }
}

/**
 * Append a structured log line. Writes one JSON object per line to the current
 * day's file under the logs directory. Never throws — logging must not break
 * the request it is describing.
 */
export function log(
  level: LogLevel,
  category: LogCategory | string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    category,
    message,
    ...(meta && Object.keys(meta).length ? { meta } : {}),
  }
  try {
    ensureDir()
    fs.appendFileSync(logFileFor(new Date()), JSON.stringify(entry) + '\n', 'utf8')
    cleanupOldLogs()
  } catch { /* disk not writable — drop the line rather than crash */ }
}

export interface ReadLogsOptions {
  level?: LogLevel          // minimum level
  category?: string         // exact category match
  search?: string           // case-insensitive substring of message
  limit?: number            // most-recent N entries (default 2000)
}

/** Read and filter recent log entries across the retention window. */
export function readLogs(opts: ReadLogsOptions = {}): LogEntry[] {
  const dir = getLogsDir()
  const limit = opts.limit ?? 2000
  let files: string[]
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .sort() // chronological by name
  } catch {
    return []
  }

  const minRank = opts.level ? LEVEL_RANK[opts.level] : 0
  const search = opts.search?.toLowerCase()
  const entries: LogEntry[] = []

  // Read newest files first so we can stop once we have enough.
  for (const f of files.reverse()) {
    let lines: string[]
    try {
      lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n')
    } catch {
      continue
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]
      if (!line) continue
      let e: LogEntry
      try {
        e = JSON.parse(line) as LogEntry
      } catch {
        continue
      }
      if (LEVEL_RANK[e.level] < minRank) continue
      if (opts.category && e.category !== opts.category) continue
      if (search && !e.message.toLowerCase().includes(search)) continue
      entries.push(e)
      if (entries.length >= limit) break
    }
    if (entries.length >= limit) break
  }

  // entries collected newest-first; return chronological (oldest-first)
  return entries.reverse()
}

/** Path to today's log file (for "open log folder"). */
export function currentLogFile(): string {
  return logFileFor(new Date())
}
