/** The first-start setup's per-browser memory, kept like the tour's (lib/tour.ts). */

/** Set when the setup's last step is clicked — the top bar's "Start here" then moves into Settings. */
export const SETUP_DONE_KEY = 'raccoon-studio:setup-v1'
/** Set once an existing user has answered the 2.0 "run the setup?" offer, either way. */
export const SETUP_OFFER_KEY = 'raccoon-studio:setup-offer-v1'
/** Fired after `markSetupDone`, so the top bar drops "Start here" without a reload. */
export const SETUP_EVENT = 'raccoon-studio:setup-changed'

const read = (k: string) => {
  try { return localStorage.getItem(k) === '1' } catch { return false }
}
const write = (k: string) => {
  try { localStorage.setItem(k, '1') } catch { /* quota or unavailable */ }
}

export const setupDone = () => read(SETUP_DONE_KEY)
export function markSetupDone() {
  write(SETUP_DONE_KEY)
  window.dispatchEvent(new Event(SETUP_EVENT))
}
export const offerSeen = () => read(SETUP_OFFER_KEY)
export const markOfferSeen = () => write(SETUP_OFFER_KEY)
