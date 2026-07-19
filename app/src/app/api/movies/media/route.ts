import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { PROJECTS_DIR } from '@/lib/movies/projects'
import { assertEntitled } from '@/lib/addons/guard'

const OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR ?? ''

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
}

function isAllowed(filePath: string): boolean {
  const roots = [path.resolve(PROJECTS_DIR), OUTPUT_DIR ? path.resolve(OUTPUT_DIR) : '']
  return roots.some((root) => root && filePath.startsWith(root + path.sep))
}

export async function GET(req: NextRequest) {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  const raw = req.nextUrl.searchParams.get('path')
  if (!raw) return NextResponse.json({ error: 'Missing path' }, { status: 400 })
  const filePath = path.resolve(raw)
  if (!isAllowed(filePath)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
