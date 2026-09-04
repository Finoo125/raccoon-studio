import crypto from 'crypto'
import { readJson, writeJson } from '@/lib/system/json-store'
import { UNLOCK_URL } from '@/lib/addons/membership'

/**
 * Civitai OAuth — authorization code + PKCE.
 *
 * Measured against the live API 2026-08-27; see the design doc's "Verified
 * against the live API" section. Four facts shaped this file, each of which
 * contradicts the obvious assumption:
 *
 * - **Device flow is confidential-clients-only.** A public client gets
 *   `unauthorized_client`, and the device-code grant answers
 *   `invalid_client: cannot retrieve client credentials`. Authorization code is
 *   the only grant a shipped local app can use.
 * - **`scope` is ONE decimal integer**, not a space-delimited list. Their
 *   `stringToScope` does `parseInt` on the first element, so a list would parse
 *   as its first value alone. The discovery document enumerates the *bits*,
 *   which reads misleadingly like a list of scope tokens.
 * - **There is no default scope.** Omitting it returns `invalid_scope` *after*
 *   the user has logged in.
 * - **The granted scope can exceed the requested one.** Asking for 4 returned
 *   5. Read it off the token response rather than assuming.
 */

/** Public client. No secret exists, by design — PKCE replaces it. Registered on
 *  the project owner's Civitai account; deleting that registration breaks
 *  sign-in for every install at once. */
export const CIVITAI_CLIENT_ID = 'e3ffdc3f-aff4-4612-a274-f4d3a7023a2f'

/** TokenScope.UserRead(1) | TokenScope.ModelsRead(4). A single decimal string. */
export const CIVITAI_SCOPE = '5'

export const CIVITAI_REDIRECT_URI = 'http://localhost:3000/api/civitai/auth/callback'

/**
 * The relay, for every install the registered redirect above cannot reach.
 *
 * Civitai's OpenID discovery document publishes **no `registration_endpoint`**,
 * so an install cannot register its own redirect and every copy of the app
 * shares one client and one registered URI. `localhost:3000` is right for a
 * desktop install and actively wrong on a pod, where the browser lands on the
 * *user's own* machine — which, if they also run the studio locally, answers,
 * finds no sign-in in progress and drops them on their local Models page. That
 * reads as "the button did nothing" rather than as a redirect landing a whole
 * machine away.
 *
 * So the second registered URI points at the unlock worker, which forwards the
 * code to the origin carried in `state`. It only ever moves a code that is
 * useless without the PKCE verifier, and the verifier never leaves the install.
 */
export const CIVITAI_RELAY_URI = `${UNLOCK_URL}/civitai/callback`

/**
 * Which registered redirect suits the browser that started the sign-in.
 *
 * Exact-origin, not a localhost pattern: `http://127.0.0.1:3000` and
 * `http://localhost:3001` are *not* the registered URI either, and today both
 * fail the same way a pod does. Sending anything but the one registered origin
 * through the relay fixes those for free.
 *
 * No origin means an older client that does not send one — keep the direct URI,
 * so the desktop path is unchanged by construction.
 */
export function redirectUriFor(origin?: string | null): string {
  if (!origin) return CIVITAI_REDIRECT_URI
  return origin === new URL(CIVITAI_REDIRECT_URI).origin ? CIVITAI_REDIRECT_URI : CIVITAI_RELAY_URI
}

/**
 * `state` doubles as the return address: `<nonce>.<base64url(origin)>`.
 *
 * Civitai echoes `state` back verbatim and it is the only field that survives
 * the round trip, so the relay has nowhere else to learn where to send the
 * browser. The nonce still does its own job — the callback compares the whole
 * string against the pending record, so the origin is covered by that check
 * rather than trusted separately.
 */
export const packState = (nonce: string, origin?: string | null): string =>
  origin ? `${nonce}.${Buffer.from(origin).toString('base64url')}` : nonce

/** The origin packed into a state string, or null if it carries none.
 *  ⚠️ The relay has its own copy of this — `worker/src/index.js`, which has no
 *  `Buffer` and decodes with `atob`. Change one, change both. */
export function originFromState(state: string): string | null {
  const dot = state.indexOf('.')
  if (dot < 0) return null
  try {
    const raw = Buffer.from(state.slice(dot + 1), 'base64url').toString()
    // `new URL(x).origin === x` rejects anything carrying a path, query or
    // credentials — this value ends up as a redirect base.
    return new URL(raw).origin === raw ? raw : null
  } catch {
    return null
  }
}

export const CIVITAI_AUTH_BASE = 'https://auth.civitai.com/api/auth/oauth'
export const CIVITAI_API_BASE = 'https://civitai.com/api/v1'

/**
 * A PKCE verifier.
 *
 * Hex, not base64: `base64` wraps at 76 characters, and the resulting newline is
 * rejected as a *malformed parameter* rather than a mismatch — which sends the
 * debugging in entirely the wrong direction. 32 bytes of hex is 64 characters,
 * all inside RFC 7636's unreserved set, with nothing to strip.
 */
export function createVerifier(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function challengeFor(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

export function authorizeUrl(
  { challenge, state, redirectUri = CIVITAI_REDIRECT_URI }:
  { challenge: string; state: string; redirectUri?: string },
): string {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: CIVITAI_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: CIVITAI_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })
  return `${CIVITAI_AUTH_BASE}/authorize?${p.toString()}`
}

// ─── Token store ─────────────────────────────────────────────────────────────

/**
 * Tokens live in their own file beside `.entitlements.json`, deliberately NOT
 * in `AppSettings`: `GET /api/settings` returns that whole object to the
 * browser, which on a remotely-accessed install would put the token on the wire.
 */
const AUTH_FILE = 'civitai-auth.json'

export interface StoredAuth {
  accessToken: string
  refreshToken: string
  /** Epoch ms. */
  expiresAt: number
  username?: string
}

export function readAuth(): StoredAuth | null {
  const a = readJson<StoredAuth | null>(AUTH_FILE, null)
  return a && a.accessToken ? a : null
}

export function writeAuth(a: StoredAuth): void { writeJson(AUTH_FILE, a) }

export function clearAuth(): void { writeJson(AUTH_FILE, null) }

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  error?: string
  error_description?: string
}

async function postToken(body: Record<string, string>): Promise<StoredAuth> {
  const res = await fetch(`${CIVITAI_AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  const json = (await res.json()) as TokenResponse
  if (!res.ok || json.error) {
    throw new Error(json.error_description ?? json.error ?? `Token request failed (${res.status})`)
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    // 60 s of slack so a request started just under the wire does not race the expiry.
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  }
}

/** `redirectUri` must be byte-identical to the one the authorize used, which is
 *  why the pending record carries it rather than this recomputing it. */
export function exchangeCode(
  code: string,
  verifier: string,
  redirectUri: string = CIVITAI_REDIRECT_URI,
): Promise<StoredAuth> {
  return postToken({
    grant_type: 'authorization_code',
    client_id: CIVITAI_CLIENT_ID,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  })
}

/** Refresh tokens rotate on use, so the result replaces the whole record. */
export function refreshAuth(a: StoredAuth): Promise<StoredAuth> {
  return postToken({
    grant_type: 'refresh_token',
    client_id: CIVITAI_CLIENT_ID,
    refresh_token: a.refreshToken,
  })
}

export async function revokeAuth(a: StoredAuth): Promise<void> {
  for (const token of [a.accessToken, a.refreshToken]) {
    try {
      await fetch(`${CIVITAI_AUTH_BASE}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CIVITAI_CLIENT_ID, token }).toString(),
      })
    } catch { /* best effort — local state is cleared regardless */ }
  }
}

/**
 * Swap the stored refresh token for a new pair, or disconnect trying.
 *
 * A failed refresh means consent was revoked on civitai.com, which is not
 * recoverable — land the user back on the connect screen rather than retrying
 * forever against a token the server will never accept again.
 */
async function refreshStored(): Promise<string> {
  const auth = readAuth()
  if (!auth) throw new Error('Not connected to Civitai.')
  try {
    const refreshed = await refreshAuth(auth)
    writeAuth({ ...refreshed, username: auth.username })
    return refreshed.accessToken
  } catch {
    clearAuth()
    throw new Error('Your Civitai session expired. Please sign in again.')
  }
}

/**
 * An access token that is valid *now*. Every Civitai call goes through this.
 *
 * ⚠️ **The expiry has to be checked here; a 401 never arrives to do it.** Access
 * tokens last an hour, and the two endpoints this app reads most —
 * `/api/v1/models` and `/api/v1/models/:id` — answer **200 for an invalid
 * token** (measured 2026-08-27, and again 08-28 against a real token, a garbage
 * string and no token at all: all three 200). So a refresh-on-401 alone never
 * fires, and the session rots invisibly: search keeps working, the connect panel
 * keeps saying "connected as …", and the only symptom is that creator-gated
 * downloads start failing with a bare HTTP 401 an hour after sign-in. Measured
 * on `[ZIT] Mystic XXX`, whose v3–v7 are open and v1–v2 gated: with a dead token
 * v7 downloads and v2 401s, on the same model in the same session.
 */
export async function freshToken(): Promise<string> {
  const auth = readAuth()
  if (!auth) throw new Error('Not connected to Civitai.')
  return auth.expiresAt > Date.now() ? auth.accessToken : refreshStored()
}

/**
 * Authenticated fetch against Civitai.
 *
 * The 401 retry is a backstop for the cases the clock cannot predict — consent
 * revoked mid-session, or a token invalidated early. The ordinary expiry is
 * handled by `freshToken` before the request is ever sent.
 */
export async function civitaiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string) =>
    fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } })

  const res = await send(await freshToken())
  if (res.status !== 401) return res
  return send(await refreshStored())
}
