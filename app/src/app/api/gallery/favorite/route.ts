import { NextRequest, NextResponse } from 'next/server'
import { writeFavorite } from '@/lib/gallery/scanner'

export async function POST(req: NextRequest) {
  const { id, value } = (await req.json()) as { id: string; value: boolean }
  writeFavorite(id, value)
  return NextResponse.json({ ok: true })
}
