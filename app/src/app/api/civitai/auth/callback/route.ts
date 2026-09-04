import { NextRequest, NextResponse } from 'next/server'
import { assertEntitled } from '@/lib/addons/guard'
import {
  CIVITAI_AUTH_BASE, exchangeCode, originFromState, writeAuth, type StoredAuth,
} from '@/lib/civitai/oauth'
import { clearPending, readPending } from '@/lib/civitai/pending'

/**
 * Best-effort display name. A failure here must NOT fail the sign-in: the token
 * is already valid and the username is only a label on the connect panel.
 */
async function fetchUsername(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${CIVITAI_AUTH_BASE}/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return undefined
    return ((await res.json()) as { username?: string }).username
  } catch {
    return undefined
  }
}

/** Shared by the redirect path and the paste-a-URL path. */
async function completeSignIn(code: string, state: string): Promise<void> {
  const pending = readPending()
  if (!pending) throw new Error('No sign-in is in progress. Start again from the Models page.')
  if (state !== pending.state) throw new Error('Sign-in could not be verified. Start again.')

  const auth: StoredAuth = await exchangeCode(code, pending.verifier, pending.redirectUri)
  auth.username = await fetchUsername(auth.accessToken)
  writeAuth(auth)
  clearPending()
}

export async function GET(req: NextRequest) {
  const denied = await assertEntitled('civitai-browser')
  if (denied) return denied

  const q = req.nextUrl.searchParams

  // Where to land the browser afterwards. Read out of OUR pending record, never
  // out of the incoming `state` — taking the query's word for it would turn this
  // route into an open redirector, and every branch below reaches `back()`
  // before the state has been checked. Captured up here because a successful
  // sign-in clears the record before the redirect is built.
  const home = originFromState(readPending()?.state ?? '') ?? req.nextUrl.origin
  const back = (params: string) => NextResponse.redirect(new URL(`/models?${params}`, home))

  const providerError = q.get('error')
  if (providerError) return back(`civitai=error&reason=${encodeURIComponent(providerError)}`)

  const code = q.get('code')
  const state = q.get('state')
  if (!code || !state) return back('civitai=error&reason=missing_code')

  try {
    await completeSignIn(code, state)
    return back('civitai=connected')
  } catch (e) {
    return back(`civitai=error&reason=${encodeURIComponent(e instanceof Error ? e.message : 'failed')}`)
  }
}

/**
 * The remote-install path.
 *
 * The registered redirect is `localhost:3000`, which resolves only when the
 * browser and the app share a machine. On a pod or over LAN that page cannot
 * reach this install — so the user pastes the URL their browser was sent to and
 * we parse the code out of it here.
 */
export async function POST(req: NextRequest) {
  const denied = await assertEntitled('civitai-browser')
  if (denied) return denied

  let redirectUrl: string
  try {
    redirectUrl = ((await req.json()) as { redirectUrl?: string }).redirectUrl ?? ''
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  let params: URLSearchParams
  try {
    params = new URL(redirectUrl).searchParams
  } catch {
    return NextResponse.json({ error: 'That does not look like a URL.' }, { status: 400 })
  }

  const code = params.get('code')
  const state = params.get('state')
  if (!code || !state) {
    return NextResponse.json({ error: 'That URL has no sign-in code in it.' }, { status: 400 })
  }

  try {
    await completeSignIn(code, state)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Sign-in failed' },
      { status: 400 },
    )
  }
}
