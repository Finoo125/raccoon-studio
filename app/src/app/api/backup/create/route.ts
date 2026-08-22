import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { resolveBackupPaths, DELETABLE_COMPONENT_IDS } from '@/lib/backup/paths'
import { planComponents } from '@/lib/backup/components'
import { startBackupJob } from '@/lib/backup/job'
import { defaultBackupName } from '@/lib/backup/native-dialog'
import { isKiosk } from '@/lib/system/kiosk'
import { getDataDir } from '@/lib/system/paths'

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

  let destPath = body.destPath?.trim()
  if (!destPath) {
    // A hosted pod has no desktop for a "save as" dialog to open on, and even a
    // working one would be picking a path on the SERVER while the person is in
    // a browser somewhere else. So on a pod the server names the file and the
    // browser fetches it afterwards from /api/backup/download. Desktop installs
    // are unchanged: an absent destination there is still a bug worth a 400.
    if (!isKiosk()) {
      return NextResponse.json({ error: 'No destination was chosen.' }, { status: 400 })
    }
    const dir = path.join(getDataDir(), 'backups')
    fs.mkdirSync(dir, { recursive: true })
    destPath = path.join(dir, defaultBackupName())
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
