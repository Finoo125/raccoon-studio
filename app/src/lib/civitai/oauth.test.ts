import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  createVerifier, challengeFor, authorizeUrl, CIVITAI_CLIENT_ID,
  CIVITAI_REDIRECT_URI, CIVITAI_RELAY_URI, redirectUriFor, packState, originFromState,
  civitaiFetch, freshToken, readAuth, writeAuth, clearAuth,
} from './oauth'

describe('PKCE', () => {
  it("makes a verifier inside PKCE's unreserved charset, 43-128 chars", () => {
    // Measured trap: `base64` line-wraps at 76 chars and the embedded newline
    // makes Civitai answer `invalid_request: Invalid parameter: code_verifier`
    // — a format complaint pointing nowhere near the wrapping that caused it.
    for (let i = 0; i < 20; i++) {
      const v = createVerifier()
      expect(v).toMatch(/^[A-Za-z0-9._~-]{43,128}$/)
      expect(v).not.toContain('\n')
    }
  })

  it('makes distinct verifiers', () => {
    expect(createVerifier()).not.toBe(createVerifier())
  })

  it('derives a base64url S256 challenge with no padding', () => {
    // RFC 7636 appendix B's own vector.
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      .toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
})

describe('authorizeUrl', () => {
  const url = () => new URL(authorizeUrl({ challenge: 'CHAL', state: 'STATE' }))

  it('points at the auth host, not the API host', () => {
    expect(url().origin).toBe('https://auth.civitai.com')
    expect(url().pathname).toBe('/api/auth/oauth/authorize')
  })

  it('sends scope as ONE decimal string', () => {
    // Verified against their source: `stringToScope` does parseInt on the first
    // element, so a space-delimited list would parse as its first value alone.
    // 5 = UserRead(1) | ModelsRead(4).
    expect(url().searchParams.get('scope')).toBe('5')
  })

  it('carries every parameter the server requires', () => {
    // Omitting any of these fails only AFTER the user has logged in, which is
    // an expensive way to find a typo.
    const p = url().searchParams
    expect(p.get('response_type')).toBe('code')
    expect(p.get('client_id')).toBe(CIVITAI_CLIENT_ID)
    expect(p.get('code_challenge')).toBe('CHAL')
    expect(p.get('code_challenge_method')).toBe('S256')
    expect(p.get('state')).toBe('STATE')
    expect(p.get('redirect_uri')).toBe('http://localhost:3000/api/civitai/auth/callback')
  })

  it('sends the redirect URI it was handed, so a relayed sign-in can match it', () => {
    // The token exchange has to repeat this value byte for byte; a default
    // silently substituted here would only fail after the user has consented.
    const relayed = new URL(authorizeUrl({
      challenge: 'CHAL', state: 'STATE', redirectUri: CIVITAI_RELAY_URI,
    }))
    expect(relayed.searchParams.get('redirect_uri')).toBe(CIVITAI_RELAY_URI)
  })
})

describe('redirectUriFor', () => {
  it('keeps the direct URI for the one origin it is registered under', () => {
    expect(redirectUriFor('http://localhost:3000')).toBe(CIVITAI_REDIRECT_URI)
  })

  it('relays a pod, which is the whole point', () => {
    expect(redirectUriFor('https://abc123-3000.proxy.runpod.net')).toBe(CIVITAI_RELAY_URI)
  })

  it('relays the near-misses that look local but are not registered', () => {
    // Both of these fail today in exactly the way a pod does: Civitai returns
    // the browser to `localhost:3000`, which is not where the user is.
    expect(redirectUriFor('http://127.0.0.1:3000')).toBe(CIVITAI_RELAY_URI)
    expect(redirectUriFor('http://localhost:3001')).toBe(CIVITAI_RELAY_URI)
    expect(redirectUriFor('http://192.168.1.40:3000')).toBe(CIVITAI_RELAY_URI)
  })

  it('falls back to the direct URI when no origin is sent', () => {
    // An older client posts no body. Desktop behaviour must not change.
    expect(redirectUriFor()).toBe(CIVITAI_REDIRECT_URI)
    expect(redirectUriFor(null)).toBe(CIVITAI_REDIRECT_URI)
    expect(redirectUriFor('not a url')).toBe(CIVITAI_RELAY_URI)
  })
})

describe('state packing', () => {
  it('round-trips the origin the relay has to send the browser back to', () => {
    const s = packState('NONCE', 'https://abc123-3000.proxy.runpod.net')
    expect(originFromState(s)).toBe('https://abc123-3000.proxy.runpod.net')
  })

  it('leaves a direct sign-in with the bare nonce it always had', () => {
    expect(packState('NONCE')).toBe('NONCE')
    expect(originFromState('NONCE')).toBeNull()
  })

  it('refuses anything that is not a bare origin', () => {
    // This value becomes a redirect base, so a path or credentials smuggled
    // into it must not survive the trip.
    const packed = (raw: string) => `N.${Buffer.from(raw).toString('base64url')}`
    expect(originFromState(packed('https://evil.test/steal?x=1'))).toBeNull()
    expect(originFromState(packed('https://user:pw@evil.test'))).toBeNull()
    expect(originFromState(packed('javascript:alert(1)'))).toBeNull()
    expect(originFromState('N.@@@not base64@@@')).toBeNull()
  })
})

// ─── Token store, refresh, retry ─────────────────────────────────────────────

describe('civitaiFetch', () => {
  let tmp: string

  beforeEach(async () => {
    // RACCOON_DATA_DIR reroutes json-store, so these never touch the real data dir.
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-civitai-'))
    process.env.RACCOON_DATA_DIR = tmp
    const { writeAuth } = await import('./oauth')
    writeAuth({ accessToken: 'AT1', refreshToken: 'RT1', expiresAt: Date.now() + 3_600_000 })
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
    delete process.env.RACCOON_DATA_DIR
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('attaches the stored bearer token', async () => {
    // Params are declared so `mock.calls[0][1]` has a type; a bare `vi.fn(async
    // () => …)` types calls as `[]` and only tsc notices, not the test run.
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await civitaiFetch('https://civitai.com/api/v1/models')

    const init = fetchMock.mock.calls[0][1]
    expect(new Headers(init?.headers as HeadersInit).get('authorization')).toBe('Bearer AT1')
  })

  it('refreshes once on 401 and retries the original request', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url)
      if (url.includes('/oauth/token')) {
        return new Response(JSON.stringify({
          access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600,
        }), { status: 200 })
      }
      const auth = new Headers(init?.headers as HeadersInit).get('authorization')
      return new Response('{}', { status: auth === 'Bearer AT2' ? 200 : 401 })
    }))

    const res = await civitaiFetch('https://civitai.com/api/v1/models')

    expect(res.status).toBe(200)
    expect(calls.filter((c) => c.includes('/oauth/token'))).toHaveLength(1)
    expect(readAuth()?.accessToken).toBe('AT2')
  })

  it('clears the stored auth when the refresh itself fails', async () => {
    // A revoked consent must land the user back on the connect screen, not in a
    // refresh loop retrying a token the server will never accept again.
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('/oauth/token')
        ? new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
        : new Response('{}', { status: 401 })))

    await expect(civitaiFetch('https://civitai.com/api/v1/models')).rejects.toThrow(/sign in again/i)
    expect(readAuth()).toBeNull()
  })

  it('throws a clear error when nothing is connected', async () => {
    clearAuth()
    await expect(civitaiFetch('https://civitai.com/api/v1/models')).rejects.toThrow(/not connected/i)
  })
})

describe('freshToken', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-civitai-ft-'))
    process.env.RACCOON_DATA_DIR = tmp
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
    delete process.env.RACCOON_DATA_DIR
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns the stored token without a network call while it is still valid', async () => {
    writeAuth({ accessToken: 'AT1', refreshToken: 'RT1', expiresAt: Date.now() + 3_600_000 })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await freshToken()).toBe('AT1')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes BEFORE the request when the stored token has expired', async () => {
    // The regression this exists for: access tokens last an hour, and the two
    // endpoints this app reads answer 200 for a dead token — so waiting for a
    // 401 means the refresh never happens and gated downloads 401 forever.
    writeAuth({ accessToken: 'OLD', refreshToken: 'RT1', expiresAt: Date.now() - 1_000 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'NEW', refresh_token: 'RT2', expires_in: 3600,
    }), { status: 200 })))

    expect(await freshToken()).toBe('NEW')
    expect(readAuth()?.accessToken).toBe('NEW')
    expect(readAuth()?.refreshToken).toBe('RT2') // rotates on use
  })

  it('keeps the username across a refresh', async () => {
    writeAuth({
      accessToken: 'OLD', refreshToken: 'RT1',
      expiresAt: Date.now() - 1_000, username: 'Finoo125',
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'NEW', refresh_token: 'RT2', expires_in: 3600,
    }), { status: 200 })))

    await freshToken()
    expect(readAuth()?.username).toBe('Finoo125')
  })

  it('disconnects rather than looping when the refresh token is dead too', async () => {
    writeAuth({ accessToken: 'OLD', refreshToken: 'RT1', expiresAt: Date.now() - 1_000 })
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })))

    await expect(freshToken()).rejects.toThrow(/sign in again/i)
    expect(readAuth()).toBeNull()
  })

  it('throws when nothing is connected', async () => {
    clearAuth()
    await expect(freshToken()).rejects.toThrow(/not connected/i)
  })
})
