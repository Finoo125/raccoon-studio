import { NextRequest, NextResponse } from 'next/server'
import { readLogs, type LogLevel } from '@/lib/logging/logger'

const LEVELS = new Set<LogLevel>(['debug', 'info', 'warn', 'error'])

/**
 * Recent application log entries for the Logs tab. Thin wrapper over the
 * logger's `readLogs`, with level/category/search/limit driven by query params.
 * Node runtime (reads the log files off disk).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const levelParam = sp.get('level') as LogLevel | null
  const level = levelParam && LEVELS.has(levelParam) ? levelParam : undefined
  const category = sp.get('category') || undefined
  const search = sp.get('search') || undefined
  const limitParam = Number(sp.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 5000) : undefined

  try {
    const entries = readLogs({ level, category, search, limit })
    return NextResponse.json({ entries })
  } catch (e) {
    return NextResponse.json({ entries: [], error: String(e) }, { status: 500 })
  }
}
