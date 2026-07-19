import { NextResponse } from 'next/server'
import { cancelBackupJob, getBackupJob } from '@/lib/backup/job'

export const runtime = 'nodejs'

export async function POST() {
  const cancelled = cancelBackupJob()
  return NextResponse.json({ cancelled, job: getBackupJob() })
}
