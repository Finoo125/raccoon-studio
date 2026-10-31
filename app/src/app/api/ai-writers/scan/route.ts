import { NextResponse } from 'next/server'
import { scanWriters } from '@/lib/ai-writers/scan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Every AI writer on this PC and the state of its program — the Prompt Helper's writer setup reads this. */
export async function GET() {
  return NextResponse.json(await scanWriters())
}
