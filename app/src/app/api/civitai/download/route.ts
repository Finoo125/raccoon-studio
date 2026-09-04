import { NextRequest, NextResponse } from 'next/server'
import { assertEntitled } from '@/lib/addons/guard'
import { downloadUrlFor } from '@/lib/civitai/client'
import { freshToken } from '@/lib/civitai/oauth'
import { startTransfer } from '@/lib/models/transfers'

/**
 * Start a Civitai download.
 *
 * The URL is built HERE and never leaves the server: the browser sends a version
 * id, and the token is attached on this side. `startTransfer` already takes an
 * arbitrary URL and follows redirects, so nothing in the transfer layer needs to
 * know Civitai exists — and progress, cancel and the restart prompt all come
 * free with it.
 */
export async function POST(req: NextRequest) {
  const denied = await assertEntitled('civitai-browser')
  if (denied) return denied

  let body: { versionId?: number; filename?: string; folder?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { versionId, filename, folder } = body
  if (!versionId || !filename || !folder) {
    return NextResponse.json(
      { error: 'versionId, filename and folder are required.' },
      { status: 400 },
    )
  }
  // Allow-list rather than pass-through: `folder` arrives from the browser and
  // becomes a path under models/.
  if (folder !== 'loras' && folder !== 'checkpoints') {
    return NextResponse.json({ error: 'Unsupported destination folder.' }, { status: 400 })
  }

  // `freshToken`, never `readAuth().accessToken`: a stored token is only valid
  // for an hour and nothing else on this path would notice it had aged out —
  // the download is the one call Civitai actually authenticates, so an expired
  // token surfaces here as a bare 401 and nowhere else.
  let token: string
  try {
    token = await freshToken()
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Not connected to Civitai.' },
      { status: 401 },
    )
  }

  const { transfer, error } = startTransfer({
    url: downloadUrlFor(versionId, token),
    path: folder,
    name: filename,
  })
  if (error) return NextResponse.json({ error }, { status: 400 })
  return NextResponse.json({ ok: true, transfer })
}
