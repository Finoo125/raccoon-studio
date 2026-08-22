import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { resolveBackupPaths } from '@/lib/backup/paths'
import { planComponents, stagingDir } from '@/lib/backup/components'
import { isKiosk } from '@/lib/system/kiosk'

export const runtime = 'nodejs'

/**
 * Receive a backup archive from the browser, one chunk at a time.
 *
 * Restore on a pod cannot use the native "open file" dialog for the same reason
 * backup could not use "save as" — the dialog would open on a headless server
 * while the person is on their own PC. The archive therefore has to be uploaded.
 *
 * **It is chunked because it has to be.** RunPod's edge rejects any request body
 * over ~500 MiB with a 413, and that rejection happens before our code runs, so
 * nothing server-side can widen it. A real backup carrying gallery media passes
 * that easily. Many small requests are the only way through, so the client
 * slices the file and each chunk lands well under the ceiling.
 *
 * `offset` makes the append explicit rather than positional: chunks that arrive
 * out of order, or a retry that duplicates one, are caught here instead of
 * quietly producing a corrupt tar that only fails much later, halfway through a
 * restore that has already started overwriting things.
 */
export async function POST(req: NextRequest) {
  // Desktop installs pick a path with a real dialog and never copy gigabytes
  // through the browser; leaving this open there would be a needless way to
  // write a large file into the install.
  if (!isKiosk()) {
    return NextResponse.json({ error: 'Uploads are only used on a hosted pod.' }, { status: 403 })
  }

  const name = path.basename(req.nextUrl.searchParams.get('name') ?? '')
  const offset = Number(req.nextUrl.searchParams.get('offset') ?? '0')
  if (!name.endsWith('.tar')) {
    return NextResponse.json({ error: 'Only a .tar backup can be uploaded.' }, { status: 400 })
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return NextResponse.json({ error: 'offset must be a non-negative integer.' }, { status: 400 })
  }
  if (!req.body) {
    return NextResponse.json({ error: 'No body.' }, { status: 400 })
  }

  const paths = resolveBackupPaths()
  // The upload is staged beside the pod's own archives, which is chosen to sit
  // OUTSIDE every folder a restore will overwrite — otherwise the restore would
  // be reading its source out of a directory it is busy replacing.
  const dir = path.join(stagingDir(paths.dataDir, planComponents(paths, { includeModels: false })), 'incoming')
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, name)

  const onDisk = fs.existsSync(dest) ? fs.statSync(dest).size : 0
  if (offset === 0) {
    fs.rmSync(dest, { force: true })
  } else if (onDisk !== offset) {
    return NextResponse.json(
      { error: `Chunk out of order: file is ${onDisk} bytes, chunk starts at ${offset}.`, size: onDisk },
      { status: 409 },
    )
  }

  await pipeline(
    Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0]),
    fs.createWriteStream(dest, { flags: offset === 0 ? 'w' : 'a' }),
  )

  return NextResponse.json({ path: dest, size: fs.statSync(dest).size })
}
