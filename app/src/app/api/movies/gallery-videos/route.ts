import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { assertEntitled } from '@/lib/addons/guard'

const OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR ?? ''
const VIDEO_EXT = /\.(mp4|webm|mov|mkv|m4v)$/i

interface GalleryVideo {
  filename: string
  path: string
  /**
   * Path relative to ComfyUI's output dir, forward-slashed.
   *
   * The absolute `path` above is what the media route and the importer want;
   * this is what a ComfyUI graph wants, and the browser cannot derive one from
   * the other because it never learns COMFYUI_OUTPUT_DIR. Face swap loads a
   * clip straight out of output/ through core LoadVideo, so it needs this form.
   */
  relPath: string
  url: string
  sizeBytes: number
  modifiedAt: string
}

function walk(dir: string, depth: number, out: GalleryVideo[], root: string): void {
  if (depth < 0) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, depth - 1, out, root)
    else if (VIDEO_EXT.test(e.name)) {
      try {
        const stat = fs.statSync(p)
        out.push({
          filename: e.name,
          path: p,
          // split/join rather than a regex: path.sep is the only separator
          // node will have produced here, and it reads the same on both OSes.
          relPath: path.relative(root, p).split(path.sep).join('/'),
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
  const root = path.resolve(OUTPUT_DIR)
  walk(root, 5, videos, root)
  videos.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  return NextResponse.json({ videos })
}
