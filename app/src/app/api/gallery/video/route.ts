import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'

const OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR ?? ''

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/mp4',
}

/**
 * Serves gallery videos from disk with HTTP Range support so the <video> element
 * can seek and stream without downloading the whole file. Addressed by
 * subfolder + filename like /api/gallery/image, but range-capable for playback.
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
  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
    if (!stat.isFile()) throw new Error()
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const mime = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const range = req.headers.get('range')

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    let start = m?.[1] ? parseInt(m[1], 10) : 0
    let end = m?.[2] ? parseInt(m[2], 10) : stat.size - 1
    start = Math.min(start, stat.size - 1)
    end = Math.min(end, stat.size - 1)
    if (start > end) return new NextResponse(null, { status: 416 })
    const stream = Readable.toWeb(fs.createReadStream(filePath, { start, end })) as ReadableStream
    return new NextResponse(stream, {
      status: 206,
      headers: {
        'Content-Type': mime,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
      },
    })
  }

  const stream = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream
  return new NextResponse(stream, {
    headers: {
      'Content-Type': mime,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
