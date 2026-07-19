import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { decodeImageId, getSidecarDir } from '@/lib/gallery/scanner'

export async function POST(req: NextRequest) {
  const output = process.env.COMFYUI_OUTPUT_DIR ?? ''
  if (!output) return NextResponse.json({ error: 'COMFYUI_OUTPUT_DIR not configured' }, { status: 500 })

  let ids: string[]
  try {
    ids = ((await req.json()) as { ids?: string[] }).ids ?? []
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const root = path.resolve(output)
  const deleted: string[] = []
  const failed: string[] = []

  for (const id of ids) {
    const decoded = decodeImageId(id)
    if (!decoded) { failed.push(id); continue }
    const filePath = path.resolve(root, decoded.subfolder, decoded.filename)
    if (filePath !== root && !filePath.startsWith(root + path.sep)) { failed.push(id); continue }
    try {
      fs.rmSync(filePath, { force: true }) // force: a missing file is not an error
      try { fs.rmSync(path.join(getSidecarDir(), `${id}.json`), { force: true }) } catch { /* best effort */ }
      deleted.push(id)
    } catch {
      failed.push(id)
    }
  }

  return NextResponse.json({ deleted, failed })
}
