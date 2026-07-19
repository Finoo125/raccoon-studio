import type { MovieClip, MovieTrack } from '@/types/movie'

export const MIN_CLIP_SEC = 0.05
export const ABUT_EPS = 0.001

export function clipDuration(clip: MovieClip): number {
  return clip.outSec - clip.inSec
}

export function clipEnd(clip: MovieClip): number {
  return clip.startSec + clipDuration(clip)
}

export function sortClips(clips: MovieClip[]): MovieClip[] {
  return [...clips].sort((a, b) => a.startSec - b.startSec)
}

export function timelineDuration(tracks: MovieTrack[]): number {
  let end = 0
  for (const t of tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c))
  return end
}

/** Clip covering `timeSec`; during a crossfade overlap, the incoming (later) clip wins. */
export function clipAt(track: MovieTrack, timeSec: number): MovieClip | undefined {
  let found: MovieClip | undefined
  for (const c of sortClips(track.clips)) {
    if (c.startSec <= timeSec + ABUT_EPS && timeSec < clipEnd(c) - ABUT_EPS) found = c
  }
  return found
}

export function snapValue(value: number, targets: number[], threshold: number): number {
  let best = value
  let bestDist = threshold
  for (const t of targets) {
    const d = Math.abs(t - value)
    if (d < bestDist) { best = t; bestDist = d }
  }
  return best
}

/** Snap targets: timeline start, playhead, and every other clip's edges. */
export function snapTargets(tracks: MovieTrack[], excludeClipId: string, playheadSec: number): number[] {
  const targets = [0, playheadSec]
  for (const t of tracks) {
    for (const c of t.clips) {
      if (c.id === excludeClipId) continue
      targets.push(c.startSec, clipEnd(c))
    }
  }
  return targets
}

/**
 * Resolve a same-track move. Returns the final startSec or null when the clip
 * would overlap another clip (caller keeps the old position). Moving drops
 * crossfades, so plain no-overlap collision applies.
 */
export function resolveMove(
  clips: MovieClip[],
  clipId: string,
  desiredStart: number,
  targets: number[] = [],
  snapThreshold = 0,
): number | null {
  const clip = clips.find((c) => c.id === clipId)
  if (!clip) return null
  const dur = clipDuration(clip)
  let start = Math.max(0, desiredStart)
  const startSnapped = snapValue(start, targets, snapThreshold)
  if (startSnapped !== start) {
    start = startSnapped
  } else {
    const endSnapped = snapValue(start + dur, targets, snapThreshold)
    if (endSnapped !== start + dur) start = endSnapped - dur
  }
  start = Math.max(0, start)
  for (const other of clips) {
    if (other.id === clipId) continue
    if (start < clipEnd(other) - ABUT_EPS && other.startSec < start + dur - ABUT_EPS) return null
  }
  return start
}

export interface TrimResult { startSec: number; inSec: number; outSec: number }

/**
 * Resolve an edge trim. `assetDurationSec` is Infinity for still images
 * (no media window — trimming only changes the on-timeline duration).
 * `minStart` / `maxEnd` are the neighbour bounds (prev clip end / next clip
 * start, or 0 / Infinity at the track edges).
 */
export function resolveTrim(
  clip: MovieClip,
  assetDurationSec: number,
  edge: 'start' | 'end',
  desiredTimelineSec: number,
  minStart: number,
  maxEnd: number,
): TrimResult {
  const end = clipEnd(clip)
  if (edge === 'start') {
    const earliestByMedia = assetDurationSec === Infinity ? -Infinity : clip.startSec - clip.inSec
    const newStart = Math.min(
      Math.max(desiredTimelineSec, minStart, earliestByMedia, 0),
      end - MIN_CLIP_SEC,
    )
    const delta = newStart - clip.startSec
    if (assetDurationSec === Infinity) {
      return { startSec: newStart, inSec: clip.inSec, outSec: clip.outSec - delta }
    }
    return { startSec: newStart, inSec: clip.inSec + delta, outSec: clip.outSec }
  }
  const latestByMedia = assetDurationSec === Infinity
    ? Infinity
    : clip.startSec + (assetDurationSec - clip.inSec)
  const newEnd = Math.max(
    Math.min(desiredTimelineSec, maxEnd, latestByMedia),
    clip.startSec + MIN_CLIP_SEC,
  )
  return { startSec: clip.startSec, inSec: clip.inSec, outSec: clip.inSec + (newEnd - clip.startSec) }
}

/** Split at a timeline position. Returns [left, right] or null near the edges. */
export function splitClip(
  clip: MovieClip,
  atTimelineSec: number,
  newId: string,
): [MovieClip, MovieClip] | null {
  const end = clipEnd(clip)
  if (atTimelineSec < clip.startSec + MIN_CLIP_SEC || atTimelineSec > end - MIN_CLIP_SEC) return null
  const offset = atTimelineSec - clip.startSec
  const left: MovieClip = { ...clip, outSec: clip.inSec + offset }
  const right: MovieClip = {
    ...clip,
    id: newId,
    startSec: atTimelineSec,
    inSec: clip.inSec + offset,
    crossfadeWithPrevious: undefined,
  }
  return [left, right]
}

/**
 * Set the crossfade between a clip and its predecessor by moving the clip so
 * it overlaps the previous clip by `durationSec` (0 removes the fade and
 * restores the abutting position). Returns the updated clip array or null
 * when invalid (first clip, or the shift would collide with the next clip).
 */
export function applyCrossfade(
  clips: MovieClip[],
  clipId: string,
  durationSec: number,
): MovieClip[] | null {
  const sorted = sortClips(clips)
  const idx = sorted.findIndex((c) => c.id === clipId)
  if (idx <= 0) return null
  const prev = sorted[idx - 1]
  const clip = sorted[idx]
  const maxFade = Math.min(clipDuration(prev), clipDuration(clip)) - MIN_CLIP_SEC
  const d = Math.min(Math.max(0, durationSec), Math.max(0, maxFade))
  const boundary = clipEnd(prev)
  const moved: MovieClip = {
    ...clip,
    startSec: boundary - d,
    crossfadeWithPrevious: d > 0 ? d : undefined,
  }
  const next = sorted[idx + 1]
  if (next && clipEnd(moved) > next.startSec + ABUT_EPS) return null
  return clips.map((c) => (c.id === clipId ? moved : c))
}
