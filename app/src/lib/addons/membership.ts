/**
 * Where the unlock flow lives.
 *
 * `UNLOCK_URL` is the Cloudflare worker (`worker/`, deployed separately and not
 * shipped publicly). Its landing page explains the exchange and hands off to
 * `/auth` (Patreon) or `/deviantart/auth`, which redirect into that platform's
 * OAuth and mint a personal key on the way back — that is the "log in and get
 * your key" path, and it is what any primary unlock action must point at.
 *
 * `PATREON_PAGE` is the campaign itself: where someone who is *not* a supporter
 * yet goes to become one. Sending them to the unlock flow first would just show
 * them a login that ends in "you are not a patron".
 *
 * Two different jobs, hence two constants — pointing both at the same place is
 * the mistake this file exists to prevent.
 *
 * `PATREON_PAGE` is the real campaign, taken from the deployed worker's own
 * `PATREON_PAGE_URL` var (`worker/wrangler.toml`) — the worker already shows it
 * on its not-a-patron page, so the two now agree instead of the app sending
 * people to the bare domain.
 */
export const UNLOCK_URL = 'https://raccoon-unlock.finoo125.workers.dev'

export const PATREON_PAGE = 'https://www.patreon.com/c/aiworkshop'

/**
 * The second place to subscribe: the creator's DeviantArt Subscriptions tab,
 * `https://www.deviantart.com/<username>/subscriptions` — the same page the
 * worker builds from its `DEVIANTART_CREATOR` (`worker/wrangler.toml`), live
 * since 2026-10-03. Empty makes the app name Patreon alone.
 */
export const DEVIANTART_PAGE: string = 'https://www.deviantart.com/FinosMuscleGirls/subscriptions'

/** Where a key can be bought, in the order the app names them. */
export const SUBSCRIBE_PAGES = [
  { label: 'Patreon', href: PATREON_PAGE },
  ...(DEVIANTART_PAGE ? [{ label: 'DeviantArt', href: DEVIANTART_PAGE }] : []),
]
