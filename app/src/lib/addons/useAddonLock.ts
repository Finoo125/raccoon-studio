'use client'

import { useEffect } from 'react'
import { useAddonStore } from './store'

/** Entitlement id for Director mode inside Generate Video. */
export const LTX_DIRECTOR_ADDON = 'ltx-director'

/**
 * Is `featureId` locked for this install?
 *
 * For add-ons that live *inside* a page rather than on one of their own, so
 * `AddonGuard` (which redirects a whole route) does not apply. Loads
 * entitlements on first use, the same way the guard does.
 *
 * `loaded` is returned rather than folded into `locked` on purpose: before the
 * fetch resolves, nothing is unlocked, so a bare `locked` would flash the locked
 * state on every page load for someone who owns the add-on. Callers should treat
 * "not loaded yet" as unlocked and only act once `loaded` is true.
 */
export function useAddonLock(featureId: string): { locked: boolean; loaded: boolean } {
  const loaded = useAddonStore((s) => s.loaded)
  const unlocked = useAddonStore((s) => s.unlocked)
  const load = useAddonStore((s) => s.load)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  return { locked: !unlocked.includes(featureId), loaded }
}
