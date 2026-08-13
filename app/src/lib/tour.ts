/**
 * First-run guided tour: shown once, then remembered as done whether the user
 * finished it or skipped it.
 *
 * Bumping the key retires the old flag and shows the tour again — do that only
 * for a walkthrough worth interrupting existing users for.
 */
export const TOUR_KEY = 'raccoon-studio:tour-v1'

/** Settings' "Replay tour" fires this; the tour (mounted in the studio layout,
 *  so it is always alive) listens. A plain DOM event beats a store for one
 *  boolean nudge that no one needs to render. */
export const TOUR_EVENT = 'raccoon-studio:replay-tour'

/** True while the first-run tour still has to run — the models nudge stays
 *  quiet until then rather than stacking a second dialog on top of it. */
export function tourPending(): boolean {
  try {
    return !localStorage.getItem(TOUR_KEY)
  } catch {
    return false
  }
}
