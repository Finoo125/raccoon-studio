import { NextRequest, NextResponse } from 'next/server'
import { resolveBackupPaths, DELETABLE_COMPONENT_IDS } from '@/lib/backup/paths'
import { planComponents } from '@/lib/backup/components'
import { startBackupJob } from '@/lib/backup/job'

export const runtime = 'nodejs'

/**
 * Kick off a backup job and return immediately. The job runs server-side to
 * completion (it survives tab closes and reloads); the UI follows it by
 * polling GET /api/backup/job and can cancel via POST /api/backup/cancel.
 */
export async function POST(req: NextRequest) {
  let body: { destPath?: string; includeModels?: boolean; deleteAfter?: boolean }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const destPath = body.destPath?.trim()
  if (!destPath) {
    return NextResponse.json({ error: 'No destination was chosen.' }, { status: 400 })
  }
  const paths = resolveBackupPaths()
  if (!paths.outputDir) {
    return NextResponse.json({ error: 'COMFYUI_OUTPUT_DIR is not configured in .env.local.' }, { status: 500 })
  }
  const includeModels = !!body.includeModels
  if (includeModels && !paths.modelsDir) {
    return NextResponse.json({ error: 'COMFYUI_MODELS_DIR is not configured — cannot back up models.' }, { status: 400 })
  }

  const job = startBackupJob({
    destPath,
    sources: planComponents(paths, { includeModels }),
    includesModels: includeModels,
    deleteAfter: !!body.deleteAfter,
    deletableIds: DELETABLE_COMPONENT_IDS,
  })
  if (!job) {
    return NextResponse.json({ error: 'A backup or restore is already running.' }, { status: 409 })
  }
  return NextResponse.json({ job })
}
