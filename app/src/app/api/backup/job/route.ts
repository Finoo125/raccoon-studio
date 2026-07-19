import { NextResponse } from 'next/server'
import { getBackupJob } from '@/lib/backup/job'

export const runtime = 'nodejs'
// Polled for live progress — must never be statically cached.
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ job: getBackupJob() })
}
