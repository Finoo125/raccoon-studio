import { NextRequest, NextResponse } from 'next/server'
import { readWildcards, putWildcard, deleteWildcard } from '@/lib/prompts/store'

export async function GET() {
  return NextResponse.json({ wildcards: readWildcards() })
}

export async function PUT(req: NextRequest) {
  let body: { name?: string; items?: string[] }
  try { body = (await req.json()) as typeof body } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const name = (body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const items = Array.isArray(body.items) ? body.items.map((s) => s.trim()).filter(Boolean) : []
  return NextResponse.json({ wildcards: putWildcard(name, items) })
}

export async function DELETE(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')
  if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  return NextResponse.json({ wildcards: deleteWildcard(name) })
}
