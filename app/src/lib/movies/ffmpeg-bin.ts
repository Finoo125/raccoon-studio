import path from 'path'
import { getSettings } from '@/lib/settings/settings'

/**
 * FFmpeg binary resolution for Movie Maker export/probing. A configured
 * Settings path wins; otherwise the bare command relies on PATH. ffprobe is
 * assumed to sit next to a configured ffmpeg (that is how FFmpeg ships).
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
