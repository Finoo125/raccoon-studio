import { NextResponse } from 'next/server'
import { assertEntitled } from '@/lib/addons/guard'
import { clearAuth, readAuth, revokeAuth } from '@/lib/civitai/oauth'

/** Revoke upstream first, then forget locally — local state is cleared either
 *  way, so a network failure cannot strand a session the user asked to end. */
export async function POST() {
  const denied = await assertEntitled('civitai-browser')
  if (denied) return denied

  const auth = readAuth()
  if (auth) await revokeAuth(auth)
  clearAuth()
  return NextResponse.json({ ok: true })
}
