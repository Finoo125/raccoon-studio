import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildConcatList, buildConcatArgs, assertJoinable, type ClipShape } from '@/lib/video/join'
import { ffmpegBin, ffprobeBin, friendlyFfmpegError } from '@/lib/movies/ffmpeg-bin'

const execFileAsync = promisify(execFile)
const OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR ?? ''

type Clip = { filename: string; subfolder?: string }

/**
 * Join a chain of continuation clips into one file, end to end.
 *
 * **No entitlement check on purpose.** Continue-video is a free feature; Movie
 * Maker's timeline is the paid one. This does the small thing: a stream copy of
 * clips that already share a format, which is all a chain needs.
 *
 * Body: `{ clips: [{ filename, subfolder }] }`, in play order, as ComfyUI
 * reports them. Returns the joined clip's own output descriptor so the caller
 * can show it the same way it shows any render.
 */
export async function POST(req: NextRequest) {
  if (!OUTPUT_DIR) {
    return NextResponse.json({ error: 'COMFYUI_OUTPUT_DIR not configured' }, { status: 500 })
  }
  const body = (await req.json().catch(() => null)) as { clips?: Clip[] } | null
  const clips = body?.clips
  if (!Array.isArray(clips) || clips.length < 2 || clips.some((c) => !c?.filename)) {
    return NextResponse.json({ error: 'Need at least two clips, each with a filename' }, { status: 400 })
  }

  // Resolve every clip inside the output root, refusing traversal. Done before
  // any spawning so a bad path cannot reach a command line.
  const root = path.resolve(OUTPUT_DIR)
  const paths: string[] = []
  for (const c of clips) {
    const p = path.resolve(root, c.subfolder ?? '', c.filename)
    if (p !== root && !p.startsWith(root + path.sep)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!fs.existsSync(p)) {
      return NextResponse.json({ error: `Clip not found: ${c.filename}` }, { status: 404 })
    }
    paths.push(p)
  }

  // Probe before joining: a stream copy cannot change format partway, and the
  // resulting file would be broken in ways that still pass a duration check.
  const probe = ffprobeBin()
  const shapes: ClipShape[] = []
  for (const p of paths) {
    try {
      const { stdout } = await execFileAsync(probe, [
        '-v', 'error',
        '-show_entries', 'stream=codec_type,codec_name,sample_rate,width,height',
        '-of', 'json', p,
      ])
      const streams = (JSON.parse(stdout).streams ?? []) as Record<string, string | number>[]
      const v = streams.find((s) => s.codec_type === 'video')
      const a = streams.find((s) => s.codec_type === 'audio')
      shapes.push({
        sampleRate: a?.sample_rate != null ? Number(a.sample_rate) : null,
        codec: v?.codec_name != null ? String(v.codec_name) : null,
        audioCodec: a?.codec_name != null ? String(a.codec_name) : null,
        width: v?.width != null ? Number(v.width) : null,
        height: v?.height != null ? Number(v.height) : null,
      })
    } catch (e) {
      return NextResponse.json({ error: friendlyFfmpegError(e, probe) }, { status: 500 })
    }
  }
  const mismatch = assertJoinable(shapes)
  if (mismatch) return NextResponse.json({ error: mismatch }, { status: 400 })

  // Land it beside the clips it was made from, so the gallery finds it without
  // learning a new location.
  const now = new Date()
  const p2 = (n: number) => String(n).padStart(2, '0')
  const subfolder = path.join(
    'video',
    'MinimaxH3',
    `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`,
  )
  const filename = `${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}-MinimaxH3-joined.mp4`
  const outDir = path.join(root, subfolder)
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, filename)

  // Scratch file in the system temp dir, not beside the output: if this process
  // dies mid-join, a stray `.concat.txt` sitting in a gallery folder is
  // something the scan has to explain away.
  const listDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-join-'))
  const listPath = path.join(listDir, 'clips.txt')
  fs.writeFileSync(listPath, buildConcatList(paths), 'utf8')

  const ffmpeg = ffmpegBin()
  try {
    await execFileAsync(ffmpeg, buildConcatArgs(listPath, outPath))
  } catch (e) {
    return NextResponse.json({ error: friendlyFfmpegError(e, ffmpeg) }, { status: 500 })
  } finally {
    fs.rmSync(listDir, { recursive: true, force: true })
  }

  return NextResponse.json({
    filename,
    // Forward slashes: this goes back out as a ComfyUI output descriptor, and
    // that is the separator every other one in the app uses.
    subfolder: subfolder.split(path.sep).join('/'),
    type: 'output',
    clips: clips.length,
  })
}
