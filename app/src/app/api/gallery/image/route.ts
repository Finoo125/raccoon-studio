import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR ?? ''

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/**
 * Serves gallery images straight from disk so the gallery keeps working when
 * ComfyUI is offline (the ComfyUI /view proxy is unavailable then).
 */
export async function GET(req: NextRequest) {
  if (!OUTPUT_DIR) {
    return NextResponse.json({ error: 'COMFYUI_OUTPUT_DIR not configured' }, { status: 500 })
  }
  const sp = req.nextUrl.searchParams
  const subfolder = sp.get('subfolder') ?? ''
  const filename = sp.get('filename') ?? ''
  if (!filename) {
    return NextResponse.json({ error: 'Missing filename' }, { status: 400 })
  }

  const root = path.resolve(OUTPUT_DIR)
  const filePath = path.resolve(root, subfolder, filename)
  // Prevent path traversal outside the output directory.
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const ext = path.extname(filePath).toLowerCase()
  const buf = await fs.promises.readFile(filePath)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
