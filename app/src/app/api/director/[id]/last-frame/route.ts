import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { loadRun, assetsDir } from '@/lib/director/runs'
import { buildLastFrameArgs } from '@/lib/director/last-frame'
import { getComfyUIBase } from '@/lib/comfyui/server-state'
import { assertEntitled } from '@/lib/addons/guard'

const execFileAsync = promisify(execFile)
const OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR ?? ''

type Ctx = { params: Promise<{ id: string }> }

/**
 * Extract a finished clip's last frame and push it into ComfyUI's input dir so
 * the next beat's i2v can seed from it. Body: the clip's ComfyUI output
 * descriptor + the beat index. Returns { inputFilename }.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  const { id } = await params
  const run = loadRun(id)
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!OUTPUT_DIR) return NextResponse.json({ error: 'COMFYUI_OUTPUT_DIR not configured' }, { status: 500 })

  const body = (await req.json().catch(() => null)) as
    | { beatIndex: number; filename: string; subfolder?: string }
    | null
  if (!body || typeof body.beatIndex !== 'number' || !body.filename) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  // Resolve the clip path on disk (guard against traversal).
  const root = path.resolve(OUTPUT_DIR)
  const videoPath = path.resolve(root, body.subfolder ?? '', body.filename)
  if (videoPath !== root && !videoPath.startsWith(root + path.sep)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!fs.existsSync(videoPath)) {
    return NextResponse.json({ error: 'Clip not found on disk' }, { status: 404 })
  }

  // Extract the last frame into the run's assets dir.
  const dir = assetsDir(id)
  fs.mkdirSync(dir, { recursive: true })
  const outPath = path.join(dir, `beat-${body.beatIndex}-last.png`)
  try {
    await execFileAsync('ffmpeg', buildLastFrameArgs(videoPath, outPath))
  } catch (e) {
    return NextResponse.json({ error: `ffmpeg failed: ${String(e)}` }, { status: 500 })
  }

  // Upload the PNG into ComfyUI's input dir under a deterministic per-beat name.
  try {
    const buf = await fs.promises.readFile(outPath)
    const form = new FormData()
    form.append('image', new Blob([new Uint8Array(buf)], { type: 'image/png' }), `director-${id}-beat-${body.beatIndex}.png`)
    form.append('overwrite', 'true')
    form.append('type', 'input')
    const up = await fetch(`${getComfyUIBase()}/upload/image`, { method: 'POST', body: form })
    if (!up.ok) throw new Error(`upload ${up.status}`)
    const data = (await up.json()) as { name: string; subfolder?: string }
    const sub = data.subfolder ?? ''
    const inputFilename = sub ? `${sub}/${data.name}` : data.name
    return NextResponse.json({ inputFilename, videoPath })
  } catch (e) {
    return NextResponse.json({ error: `Last-frame upload failed: ${String(e)}` }, { status: 502 })
  }
}
