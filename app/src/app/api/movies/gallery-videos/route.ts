import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { assertEntitled } from '@/lib/addons/guard'

const OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR ?? ''
const VIDEO_EXT = /\.(mp4|webm|mov|mkv|m4v)$/i

interface GalleryVideo {
  filename: string
  path: string
  url: string
  sizeBytes: number
  modifiedAt: string
}

function walk(dir: string, depth: number, out: GalleryVideo[]): void {
  if (depth < 0) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, depth - 1, out)
    else if (VIDEO_EXT.test(e.name)) {
      try {
        const stat = fs.statSync(p)
        out.push({
          filename: e.name,
          path: p,
          url: `/api/movies/media?path=${encodeURIComponent(p)}`,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        })
      } catch { /* skip unreadable */ }
    }
  }
}

export async function GET() {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  if (!OUTPUT_DIR) return NextResponse.json({ videos: [] })
  const videos: GalleryVideo[] = []
  walk(path.resolve(OUTPUT_DIR), 5, videos)
  videos.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  return NextResponse.json({ videos })
}
