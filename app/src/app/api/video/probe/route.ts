import { NextRequest, NextResponse } from 'next/server'
import { probeMedia } from '@/lib/movies/ffprobe'
import { getSettings } from '@/lib/settings/settings'
import { framesFromDuration } from '@/lib/video/edit-source'

/**
 * Probe a clip ComfyUI can serve — size, length, and whether it has sound —
 * for Edit mode, which needs all four before it can build a graph. ffprobe
 * reads ComfyUI's own `/view` URL, so this works the same for an upload in
 * input/ and a gallery clip in output/, without the app knowing either folder.
 *
 * No entitlement check: it only describes a file, and the form calls it before
 * a key is even looked at.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { filename?: string; subfolder?: string; type?: string } | null
  const { filename, subfolder = '', type } = body ?? {}
  // Every path segment of both, either separator — a `..` anywhere is refused
  // before a command line is ever built.
  if (!filename || (type !== 'input' && type !== 'output') || `${subfolder}/${filename}`.split(/[\\/]/).some((p) => p === '..')) {
    return NextResponse.json({ error: 'Need { filename, subfolder?, type: input|output }' }, { status: 400 })
  }
  const url = `${getSettings().comfyuiBaseUrl.replace(/\/$/, '')}/view?${new URLSearchParams({ filename, subfolder, type })}`
  try {
    const p = await probeMedia(url)
    if (!p.hasVideo || !p.width || !p.height) {
      return NextResponse.json({ error: 'That file has no video stream' }, { status: 400 })
    }
    // Display orientation, not coded: a portrait phone clip is stored 1920×1080
    // with a ±90° matrix, VHS hands over upright frames, and sizing the render
    // off the coded shape centre-crops them into a landscape band.
    const turned = Math.abs(p.rotation) % 180 === 90
    return NextResponse.json({
      width: turned ? p.height : p.width, height: turned ? p.width : p.height, durationSec: p.durationSec,
      // Off the video stream: the container's duration includes audio overhang,
      // and a frame count VHS cannot deliver makes AddGuide drop a whole 17.
      frames: framesFromDuration(p.videoDurationSec), hasAudio: p.hasAudio,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
