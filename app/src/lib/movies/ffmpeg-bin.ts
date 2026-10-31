import fs from 'fs'
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

/**
 * Why Settings refuses this ffmpeg path, or null. The path is spawned as-is, so
 * only a local file actually named ffmpeg — never any program, never a network
 * share (UNC spawns run code off another machine).
 */
export function ffmpegPathProblem(p: string): string | null {
  if (!p) return null
  if (/^[\\/]{2}/.test(p)) return 'ffmpeg must be on this computer, not a network share'
  if (!path.isAbsolute(p)) return 'Give the full path to ffmpeg, e.g. C:\\ffmpeg\\bin\\ffmpeg.exe'
  if (!/^ffmpeg(\.exe)?$/i.test(path.basename(p))) return 'The path must point at ffmpeg (ffmpeg.exe on Windows)'
  if (!fs.statSync(p, { throwIfNoEntry: false })?.isFile()) return `ffmpeg not found at ${p}`
  return null
}

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
