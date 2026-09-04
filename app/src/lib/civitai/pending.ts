import { readJson, writeJson } from '@/lib/system/json-store'

/**
 * The verifier and state of a sign-in that has been started but not finished.
 *
 * One record, not a map: only one sign-in can be in flight per install, and a
 * second `start` legitimately supersedes the first — the user gave up on it.
 */
export interface Pending {
  verifier: string
  state: string
  /** The redirect URI the authorize was sent with. The token exchange has to
   *  repeat it exactly, and it varies per install now that remote ones relay.
   *  Optional so a sign-in started before this shipped still parses. */
  redirectUri?: string
}

const FILE = 'civitai-pending.json'

export const readPending = (): Pending | null => readJson<Pending | null>(FILE, null)
export const writePending = (p: Pending): void => writeJson(FILE, p)
export const clearPending = (): void => writeJson(FILE, null)
