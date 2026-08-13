/**
 * The two bits of Director-timeline arithmetic worth having away from the DOM:
 * snapping a dragged second to nearby landmarks, and asking which shot governs
 * a given second.
 */

/**
 * Snap `sec` to the nearest target within `thresholdPx`.
 *
 * Targets outside the visible span are ignored on purpose: snapping to
 * something scrolled off screen reads as the clip jumping on its own, which is
 * the one thing every timeline write-up warns about. The threshold is given in
 * pixels and converted through `zoom`, so it feels the same at every zoom level
 * instead of covering half the clip when zoomed out.
 */
export function snapSec(
  sec: number,
  targets: number[],
  opts: {
    zoom: number
    thresholdPx?: number
    viewStartSec?: number
    viewEndSec?: number
  },
): number {
  const { zoom, thresholdPx = 8, viewStartSec = -Infinity, viewEndSec = Infinity } = opts
  if (zoom <= 0) return sec
  const threshold = thresholdPx / zoom
  let best = sec
  let bestDist = Infinity
  for (const t of targets) {
    if (t < viewStartSec || t > viewEndSec) continue
    const d = Math.abs(t - sec)
    if (d <= threshold && d < bestDist) {
      bestDist = d
      best = t
    }
  }
  return best
}

/**
 * Pixels per second that makes the whole clip exactly fill the track area.
 *
 * This is the default rather than a fixed 70 px/s: at a fixed zoom a 10 s clip
 * used barely half the window and every edit happened in the left half of a
 * mostly-empty timeline. Falls back to 70 before the track has been measured.
 */
export function fitZoom(trackWidthPx: number, durationSeconds: number): number {
  if (!(trackWidthPx > 0) || !(durationSeconds > 0)) return 70
  return trackWidthPx / durationSeconds
}

/**
 * Which block covers `sec`, if any. Blocks no longer tile the clip — the
 * stretches between them run on the global prompt alone — so this is a
 * containment test, not "the latest one that has started".
 * Order-independent; callers hold them unsorted.
 */
export function shotAt<T extends { startSec: number; lengthSec: number }>(
  segments: T[],
  sec: number,
): T | undefined {
  let best: T | undefined
  for (const s of segments) {
    if (s.startSec > sec || s.startSec + s.lengthSec < sec) continue
    if (best === undefined || s.startSec > best.startSec) best = s
  }
  return best
}
