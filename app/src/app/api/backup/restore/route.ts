import { NextRequest, NextResponse } from 'next/server'
import { resolveBackupPaths } from '@/lib/backup/paths'
import { planComponents } from '@/lib/backup/components'
import { startRestoreJob } from '@/lib/backup/job'

export const runtime = 'nodejs'

/**
 * Kick off a restore job and return immediately. The job runs server-side to
 * completion; the UI follows it by polling GET /api/backup/job.
 */
export async function POST(req: NextRequest) {
  let body: { srcPath?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const srcPath = body.srcPath?.trim()
  if (!srcPath) {
    return NextResponse.json({ error: 'No backup file was chosen.' }, { status: 400 })
  }
  const paths = resolveBackupPaths()
  if (!paths.outputDir) {
    return NextResponse.json({ error: 'COMFYUI_OUTPUT_DIR is not configured in .env.local.' }, { status: 500 })
  }

  // Plan for every component the current install can place; the manifest
  // decides which of them the archive actually contains.
  const job = startRestoreJob({
    srcPath,
    plan: planComponents(paths, { includeModels: !!paths.modelsDir }),
  })
  if (!job) {
    return NextResponse.json({ error: 'A backup or restore is already running.' }, { status: 409 })
  }
  return NextResponse.json({ job })
}
