import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { assertEntitled } from '@/lib/addons/guard'
import {
  CIVITAI_RELAY_URI, authorizeUrl, challengeFor, createVerifier, packState, redirectUriFor,
} from '@/lib/civitai/oauth'
import { writePending } from '@/lib/civitai/pending'

/**
 * The browser's own origin, which is the only reliable view of where this
 * install is reachable.
 *
 * Server-side (`req.nextUrl.origin`, the Host header) is what a pod's proxy
 * hands us, not what the user typed — the same trap `resolveWsBase` exists for
 * in `lib/comfyui/connection.ts`. A body-less POST is an older client and keeps
 * the pre-relay behaviour.
 */
async function readOrigin(req: NextRequest): Promise<string | null> {
  try {
    return ((await req.json()) as { origin?: string }).origin ?? null
  } catch {
    return null
  }
}

/** Begin a sign-in: mint a PKCE pair, stash it server-side, hand back the URL
 *  for the browser to open. The verifier never leaves this machine. */
export async function POST(req: NextRequest) {
  const denied = await assertEntitled('civitai-browser')
  if (denied) return denied

  const origin = await readOrigin(req)
  const redirectUri = redirectUriFor(origin)
  const verifier = createVerifier()
  // The origin rides along only when the relay needs it to find its way back;
  // a direct sign-in keeps the bare nonce it has always had.
  const state = packState(
    crypto.randomBytes(16).toString('hex'),
    redirectUri === CIVITAI_RELAY_URI ? origin : null,
  )
  writePending({ verifier, state, redirectUri })

  return NextResponse.json({
    url: authorizeUrl({ challenge: challengeFor(verifier), state, redirectUri }),
  })
}
