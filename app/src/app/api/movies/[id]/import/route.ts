import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { AssetKind, MovieAsset } from '@/types/movie'
import { assetsDir, loadProject } from '@/lib/movies/projects'
import { probeMedia } from '@/lib/movies/ffprobe'
import { assertEntitled } from '@/lib/addons/guard'

const OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR ?? ''

const VIDEO_EXT = /\.(mp4|webm|mov|mkv|m4v)$/i
const AUDIO_EXT = /\.(mp3|wav|flac|ogg|m4a|aac)$/i
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i

function kindOf(filename: string): AssetKind | null {
  if (VIDEO_EXT.test(filename)) return 'video'
  if (AUDIO_EXT.test(filename)) return 'audio'
  if (IMAGE_EXT.test(filename)) return 'image'
  return null
}

async function buildAsset(filePath: string, source: MovieAsset['source']): Promise<MovieAsset | null> {
  const filename = path.basename(filePath)
  const kind = kindOf(filename)
  if (!kind) return null
  const probe = kind === 'image'
    ? { durationSec: 0, width: undefined, height: undefined, hasAudio: false }
    : await probeMedia(filePath)
  return {
    id: randomUUID(),
    kind,
    source,
    path: filePath,
    filename,
    durationSec: kind === 'image' ? 0 : probe.durationSec,
    width: probe.width,
    height: probe.height,
    hasAudio: probe.hasAudio,
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  const { id } = await params
  if (!loadProject(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const contentType = req.headers.get('content-type') ?? ''

  if (contentType.includes('multipart/form-data')) {
    const fd = await req.formData()
    const file = fd.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'Missing file' }, { status: 400 })
    const safeName = file.name.replace(/[^\w.\-()\s]/g, '_')
    if (!kindOf(safeName)) return NextResponse.json({ error: 'Unsupported file type' }, { status: 415 })
    const dest = path.join(assetsDir(id), `${Date.now()}-${safeName}`)
    fs.mkdirSync(assetsDir(id), { recursive: true })
    await fs.promises.writeFile(dest, Buffer.from(await file.arrayBuffer()))
    try {
      const asset = await buildAsset(dest, 'imported')
      return NextResponse.json({ asset }, { status: 201 })
    } catch (e) {
      fs.rmSync(dest, { force: true })
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
    }
  }

  const body = (await req.json().catch(() => ({}))) as { path?: string }
  if (!body.path || !OUTPUT_DIR) return NextResponse.json({ error: 'Missing path' }, { status: 400 })
  const root = path.resolve(OUTPUT_DIR)
  const filePath = path.resolve(body.path)
  if (!filePath.startsWith(root + path.sep)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!fs.existsSync(filePath)) return NextResponse.json({ error: 'File not found' }, { status: 404 })
  try {
    const asset = await buildAsset(filePath, 'gallery')
    if (!asset) return NextResponse.json({ error: 'Unsupported file type' }, { status: 415 })
    return NextResponse.json({ asset }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
