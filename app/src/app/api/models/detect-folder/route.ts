import { NextRequest, NextResponse } from 'next/server'
import { detectModelFolder } from '@/lib/models/detect-folder'

/**
 * Where should this file go? The importer runs in the browser and holds only a
 * path, and classification means reading the file's header — so it happens here.
 *
 * Deliberately NOT path-restricted to the models dir: the whole point is to
 * classify a file that is somewhere else on disk, before it is copied in. It
 * reads at most a few hundred KB of header and returns one enum value, so the
 * disclosure is "is the file you named a LoRA" and nothing more.
 */
export async function POST(req: NextRequest) {
  let sourcePath: string
  try {
    sourcePath = ((await req.json()) as { sourcePath?: string }).sourcePath ?? ''
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!sourcePath) return NextResponse.json({ error: 'Missing sourcePath' }, { status: 400 })

  return NextResponse.json({ folder: detectModelFolder(sourcePath) })
}
