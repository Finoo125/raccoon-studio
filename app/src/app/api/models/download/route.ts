import { NextRequest, NextResponse } from 'next/server'
import { startTransfer, listTransfers } from '@/lib/models/transfers'

export const runtime = 'nodejs'

/**
 * Start a model download and answer immediately.
 *
 * This used to hold an SSE stream open for the whole transfer, which made the
 * browser the owner of it: navigating away tore the stream down, and the route
 * answered by killing the upstream request and deleting the partial file. A
 * download is now a server-side job (see lib/models/transfers.ts) and this just
 * registers it — so leaving the page, or closing the tab, costs nothing.
 *
 * Answering at once also removes the reason the old stream needed a 15 s
 * heartbeat: a hosted pod's proxy kills any connection silent for ~125 s, and
 * progress could legitimately go quieter than that (1% of a 42 GB set is
 * 420 MB). Neither this nor the poll below can ever go quiet, so that whole
 * failure mode is designed out rather than papered over.
 */
export async function POST(req: NextRequest) {
  let body: { url?: string; path?: string; name?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { url, path, name } = body
  if (!url || !path || !name) {
    return NextResponse.json({ error: 'url, path and name are required.' }, { status: 400 })
  }

  const { transfer, error } = startTransfer({ url, path, name })
  if (error) return NextResponse.json({ error }, { status: 400 })
  return NextResponse.json({ transfer })
}

/** Everything in flight (plus recently settled), so a page opened or revisited
 *  mid-download shows what is happening instead of an idle-looking list. */
export async function GET() {
  return NextResponse.json({ transfers: listTransfers() })
}
