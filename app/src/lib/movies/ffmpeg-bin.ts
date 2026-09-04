import path from 'path'
import { getSettings } from '@/lib/settings/settings'

/**
 * FFmpeg binary resolution, shared by Movie Maker export/probing and the free
 * continue-video join. A configured Settings path wins; otherwise the bare
 * command relies on PATH. ffprobe is assumed to sit next to a configured
 * ffmpeg (that is how FFmpeg ships).
 *
 * Settings lookup only — no entitlement logic lives here, which is why a free
 * feature may import it despite the `movies/` folder.
 */

export function ffmpegBin(): string {
  return getSettings().ffmpegPath || 'ffmpeg'
}

export function ffprobeBin(): string {
  const ffmpeg = getSettings().ffmpegPath
  if (!ffmpeg) return 'ffprobe'
  return path.join(path.dirname(ffmpeg), `ffprobe${path.extname(ffmpeg)}`)
}

/** Turn a spawn failure into something a user can act on. */
export function friendlyFfmpegError(e: unknown, bin: string): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes('ENOENT')
    ? `${path.basename(bin)} was not found. Install FFmpeg, or set the full path to ffmpeg in Settings.`
    : msg
}
