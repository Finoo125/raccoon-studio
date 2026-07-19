import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { runTar } from '@/lib/backup/runner'
import { tarReadFileArgs } from '@/lib/backup/tar'
import { parseManifest } from '@/lib/backup/manifest'
import { resolveBackupPaths } from '@/lib/backup/paths'
import { planComponents } from '@/lib/backup/components'

export const runtime = 'nodejs'

/**
 * Read a backup's manifest without restoring anything, so the UI can show what
 * the archive contains (components, file counts, sizes, when/where it was
 * made) before the user confirms the restore.
 */
export async function POST(req: NextRequest) {
  let body: { srcPath?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const srcPath = body.srcPath?.trim()
  if (!srcPath) return NextResponse.json({ error: 'No backup file was chosen.' }, { status: 400 })
  if (!fs.existsSync(srcPath)) return NextResponse.json({ error: `Backup file not found: ${srcPath}` }, { status: 404 })

  try {
    const read = await runTar(tarReadFileArgs(srcPath, 'manifest.json'))
    if (read.code !== 0) {
      return NextResponse.json(
        { error: 'This file does not look like a Raccoon Studio backup (no manifest found).' },
        { status: 400 },
      )
    }
    const manifest = parseManifest(read.stdout)

    // Label components with the current install's names; unknown ids keep their id.
    const labels = new Map(
      planComponents(resolveBackupPaths(), { includeModels: true }).map((s) => [s.id, s.label]),
    )
    return NextResponse.json({
      manifest: {
        createdAt: manifest.createdAt,
        platform: manifest.platform,
        includesModels: manifest.includesModels,
        components: manifest.components.map((c) => ({
          id: c.id,
          label: labels.get(c.id) ?? c.id,
          files: c.files,
          bytes: c.bytes,
        })),
      },
      sizeBytes: fs.statSync(srcPath).size,
      hasChecksum: fs.existsSync(`${srcPath}.sha256`),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}
