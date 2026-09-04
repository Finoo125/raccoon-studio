import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { NextRequest } from 'next/server'

// The entitlement check is not what these tests are about; it has its own suite.
vi.mock('@/lib/addons/guard', () => ({ assertEntitled: async () => null }))

import { GET, POST } from './route'
import { writePending } from '@/lib/civitai/pending'
import { readAuth, packState, CIVITAI_RELAY_URI } from '@/lib/civitai/oauth'

let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-civitai-cb-'))
  process.env.RACCOON_DATA_DIR = tmp
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
  delete process.env.RACCOON_DATA_DIR
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const get = (qs: string) =>
  GET(new NextRequest(`http://localhost:3000/api/civitai/auth/callback${qs}`))

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost:3000/api/civitai/auth/callback', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }))

/** Token endpoint answers, then userinfo answers. */
const stubHappyPath = () =>
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    url.includes('/oauth/token')
      ? new Response(JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }), { status: 200 })
      : new Response(JSON.stringify({ username: 'Finoo125' }), { status: 200 })))

describe('/api/civitai/auth/callback', () => {
  it('rejects a state mismatch without exchanging anything', async () => {
    writePending({ verifier: 'V', state: 'EXPECTED' })
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)

    const res = await get('?code=C&state=WRONG')

    expect(res.headers.get('location')).toContain('civitai=error')
    expect(spy).not.toHaveBeenCalled()
    expect(readAuth()).toBeNull()
  })

  it('exchanges the code and stores the tokens on a state match', async () => {
    writePending({ verifier: 'V', state: 'S' })
    stubHappyPath()

    const res = await get('?code=C&state=S')

    expect(res.headers.get('location')).toContain('civitai=connected')
    expect(readAuth()?.accessToken).toBe('AT')
    expect(readAuth()?.username).toBe('Finoo125')
  })

  it('reports the provider error rather than swallowing it', async () => {
    writePending({ verifier: 'V', state: 'S' })
    const res = await get('?error=access_denied&state=S')
    expect(res.headers.get('location')).toContain('access_denied')
  })

  it('still signs in when userinfo fails — the token is already valid', async () => {
    writePending({ verifier: 'V', state: 'S' })
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('/oauth/token')
        ? new Response(JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }), { status: 200 })
        : new Response('nope', { status: 500 })))

    const res = await get('?code=C&state=S')

    expect(res.headers.get('location')).toContain('civitai=connected')
    expect(readAuth()?.accessToken).toBe('AT')
    expect(readAuth()?.username).toBeUndefined()
  })

  it('repeats the pending redirect URI in the token exchange', async () => {
    // A relayed sign-in authorized against the worker URI, and the exchange has
    // to send the same one — Civitai rejects a mismatch, after consent.
    writePending({ verifier: 'V', state: 'S', redirectUri: CIVITAI_RELAY_URI })
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.includes('/oauth/token')) return new Response('{}', { status: 500 })
      bodies.push(String(init?.body))
      return new Response(JSON.stringify({
        access_token: 'AT', refresh_token: 'RT', expires_in: 3600,
      }), { status: 200 })
    }))

    await get('?code=C&state=S')

    expect(new URLSearchParams(bodies[0]).get('redirect_uri')).toBe(CIVITAI_RELAY_URI)
  })

  it('lands the browser back on the pod, not on the server’s own view of itself', async () => {
    // The bug this exists for: `req.nextUrl.origin` is what the pod's proxy
    // hands Next, so building the final redirect from it sends the user to
    // localhost — the same wrong machine the relay just rescued them from.
    const origin = 'https://abc123-3000.proxy.runpod.net'
    writePending({
      verifier: 'V', state: packState('S', origin), redirectUri: CIVITAI_RELAY_URI,
    })
    stubHappyPath()

    const res = await get(`?code=C&state=${packState('S', origin)}`)

    expect(res.headers.get('location')).toBe(`${origin}/models?civitai=connected`)
  })

  it('ignores an origin smuggled in through the query string', async () => {
    // Every branch reaches the redirect before the state has been checked, so
    // trusting the incoming state would make this route an open redirector.
    writePending({ verifier: 'V', state: 'S' })

    const res = await get(`?error=access_denied&state=${packState('S', 'https://evil.test')}`)

    expect(res.headers.get('location')).toContain('http://localhost:3000/models')
  })

  it('accepts a pasted redirect URL, which is the remote-install path', async () => {
    writePending({ verifier: 'V', state: 'S' })
    stubHappyPath()

    const res = await post({
      redirectUrl: 'http://localhost:3000/api/civitai/auth/callback?code=C&state=S',
    })

    expect(res.status).toBe(200)
    expect(readAuth()?.accessToken).toBe('AT')
  })

  it('rejects a pasted URL with no code in it', async () => {
    writePending({ verifier: 'V', state: 'S' })
    const res = await post({ redirectUrl: 'http://localhost:3000/models' })
    expect(res.status).toBe(400)
    expect(readAuth()).toBeNull()
  })

  it('rejects something that is not a URL at all', async () => {
    expect((await post({ redirectUrl: 'i pressed the wrong button' })).status).toBe(400)
  })
})
