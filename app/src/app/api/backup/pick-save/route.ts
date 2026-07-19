import { NextResponse } from 'next/server'
import { pickSaveTar } from '@/lib/backup/native-dialog'

// Local-only native dialog (like the models pickers) so the multi-GB archive is
// written straight to disk, never round-tripped through the browser.
export const runtime = 'nodejs'

export async function POST() {
  try {
    return NextResponse.json({ path: await pickSaveTar() })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
