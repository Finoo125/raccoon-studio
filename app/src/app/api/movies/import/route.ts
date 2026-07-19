import { NextRequest, NextResponse } from 'next/server'
import { importBundle } from '@/lib/movies/bundle'
import { assertEntitled } from '@/lib/addons/guard'

export async function POST(req: NextRequest) {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  const fd = await req.formData().catch(() => null)
  const file = fd?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  try {
    const project = importBundle(Buffer.from(await file.arrayBuffer()))
    return NextResponse.json({ project }, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Import failed' },
      { status: 400 },
    )
  }
}
