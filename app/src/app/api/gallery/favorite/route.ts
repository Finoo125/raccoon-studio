import { NextRequest, NextResponse } from 'next/server'
import { writeFavorite } from '@/lib/gallery/scanner'

export async function POST(req: NextRequest) {
  try {
    const { id, value } = (await req.json()) as { id: string; value: boolean }
    writeFavorite(id, value)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid request' }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
