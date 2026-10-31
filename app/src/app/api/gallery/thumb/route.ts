import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { decodeImageId, VIDEO_RE } from '@/lib/gallery/scanner'
import { ensureThumb, thumbPath } from '@/lib/gallery/thumbs'

const IMAGE_RE = /\.(png|jpg|jpeg|webp)$/i

/**
 * A gallery tile's picture: a ~40 KB JPEG instead of a 2 MB PNG or a 10 MB
 * clip. The URL carries the source's mtime (`v`), so the answer never changes
 * and the browser may keep it for good.
 */
export async function GET(req: NextRequest) {
  const output = process.env.COMFYUI_OUTPUT_DIR ?? ''
  const id = req.nextUrl.searchParams.get('id') ?? ''
  const decoded = decodeImageId(id)
  if (!output || !decoded) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const root = path.resolve(output)
  const src = path.resolve(root, decoded.subfolder, decoded.filename)
  const isVideo = VIDEO_RE.test(src)
  if (!src.startsWith(root + path.sep) || !(isVideo || IMAGE_RE.test(src))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const stat = fs.statSync(src, { throwIfNoEntry: false })
  if (!stat?.isFile()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (await ensureThumb(id, src, stat.mtimeMs)) {
    return new NextResponse(new Uint8Array(await fs.promises.readFile(thumbPath(id))), {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' },
    })
  }
  // No ffmpeg: a picture is shown full size; a clip's tile plays the clip itself (VideoPoster).
  if (isVideo) return NextResponse.json({ error: 'No thumbnail' }, { status: 404 })
  const original = `/api/gallery/image?filename=${encodeURIComponent(decoded.filename)}&subfolder=${encodeURIComponent(decoded.subfolder)}`
  return new NextResponse(null, { status: 307, headers: { Location: original } })
}
