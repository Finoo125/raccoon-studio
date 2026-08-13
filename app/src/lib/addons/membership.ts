/**
 * Where the unlock flow lives.
 *
 * `UNLOCK_URL` is the Cloudflare worker (`worker/`, deployed separately and not
 * shipped publicly). Its landing page explains the exchange and hands off to
 * `/auth`, which redirects into Patreon OAuth and mints a personal key on the
 * way back — that is the "log in and get your key" path, and it is what any
 * primary unlock action must point at.
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
