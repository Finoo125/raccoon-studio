import { NextRequest, NextResponse } from 'next/server'
import { cancelTransfer } from '@/lib/models/transfers'

export const runtime = 'nodejs'

/**
 * Cancel a running download.
 *
 * Its own endpoint because cancelling is now a deliberate act. It used to be
 * implicit — tearing down the SSE stream cancelled the transfer — which meant
 * navigating away from the Models page silently threw away a part-downloaded
 * model. Nothing should destroy gigabytes of progress except someone asking.
 */
export async function POST(req: NextRequest) {
  let body: { key?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.key) return NextResponse.json({ error: 'key is required.' }, { status: 400 })
  return NextResponse.json({ cancelled: cancelTransfer(body.key) })
}
