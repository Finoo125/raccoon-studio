import { NextRequest, NextResponse } from 'next/server'
import { readAllSidecars, writeTags } from '@/lib/gallery/scanner'

export async function POST(req: NextRequest) {
  let body: { ids?: string[]; add?: string; remove?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const ids = body.ids ?? []
  // Same rule as the sidecar writer: a bad id fails the request before any file is touched.
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id))) {
    return NextResponse.json({ error: 'Invalid image id' }, { status: 400 })
  }
  const sidecars = readAllSidecars()
  for (const id of ids) {
    const current = sidecars.get(id)?.tags ?? []
    let next = current
    if (body.add) next = current.includes(body.add) ? current : [...current, body.add]
    if (body.remove) next = next.filter((t) => t !== body.remove)
    writeTags(id, next)
  }
  return NextResponse.json({ ok: true })
}
