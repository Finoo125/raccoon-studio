import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { getBackupJob } from '@/lib/backup/job'

export const runtime = 'nodejs'

/**
 * Hand the finished backup to the browser.
 *
 * Only a hosted pod needs this: on a desktop install the archive is already
 * written wherever the native "save as" dialog pointed, and streaming a
 * multi-GB tar through the browser to land it on the same disk would be absurd.
 * On a pod there is no desktop to open that dialog on, so this is the only way
 * the archive ever leaves the container.
 *
 * **There is deliberately no path parameter.** The only file this will ever
 * serve is the one the server itself just wrote, taken from the job record —
 * which is what keeps it from being a "read any file on the box" endpoint. A
 * `?path=` here would be a directory-traversal hole reachable by anyone holding
 * a session cookie.
 *
 * Streamed, not buffered: the pod's proxy pipes responses straight through
 * (`up.pipe(res)`), so a backup far larger than the container's RAM still
 * downloads, and bytes start moving immediately — which also keeps it under
 * RunPod's ~125 s silence ceiling that kills a connection delivering nothing.
 */
export async function GET() {
  const job = getBackupJob()
  if (!job || job.kind !== 'backup' || job.status !== 'done' || !job.destPath) {
    return NextResponse.json(
      { error: 'No finished backup to download. Create one first.' },
      { status: 404 },
    )
  }

  let size: number
  try {
    size = fs.statSync(job.destPath).size
  } catch {
    // The job says done but the file is gone — a restart cleared the temp dir,
    // or someone deleted it. Say so, rather than streaming a 0-byte "backup"
    // that would look like a success until the day it was needed.
    return NextResponse.json(
      { error: 'The backup finished but is no longer on disk. Create a new one.' },
      { status: 410 },
    )
  }

  const body = Readable.toWeb(fs.createReadStream(job.destPath)) as ReadableStream<Uint8Array>
  return new NextResponse(body, {
    headers: {
      'content-type': 'application/x-tar',
      'content-length': String(size),
      'content-disposition': `attachment; filename="${path.basename(job.destPath)}"`,
      'cache-control': 'no-store',
    },
  })
}
