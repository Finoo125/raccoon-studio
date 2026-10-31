/**
 * Estimate the time remaining for a running generation, extrapolating from the
 * time spent on completed steps so far. Returns a short label (`~8s`, `~1m 48s`)
 * or `null` when no estimate is possible yet (no steps done, no max, no start).
 */
export function formatEta(
  progress: number,
  maxProgress: number,
  startedAt: number | undefined,
  now: number,
): string | null {
  if (maxProgress <= 0 || progress <= 0 || startedAt === undefined) return null

  const perStep = (now - startedAt) / progress
  const remainingMs = (maxProgress - progress) * perStep
  return `~${formatSeconds(remainingMs / 1000)}`
}

/** `8s` / `1m 48s`. Shared with the video panel's render estimate. */
export function formatSeconds(seconds: number): string {
  const totalSec = Math.max(0, Math.round(seconds))
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}m ${sec}s`
}
