import { NextResponse } from 'next/server'
import { assertEntitled } from '@/lib/addons/guard'
import { freshToken, readAuth } from '@/lib/civitai/oauth'

/**
 * Never returns a token — only whether one exists and who it belongs to.
 *
 * "Connected" has to mean *usable*, not merely "a token string is on disk". The
 * tab calls this on mount, so routing it through `freshToken` both renews a
 * token that aged out while the app was closed and, when the refresh token has
 * died too, reports the disconnection honestly instead of showing a connected
 * banner over a session that can no longer download anything.
 */
export async function GET() {
  const denied = await assertEntitled('civitai-browser')
  if (denied) return denied

  const username = readAuth()?.username
  try {
    await freshToken()
  } catch {
    return NextResponse.json({ connected: false })
  }
  return NextResponse.json({ connected: true, username })
}
