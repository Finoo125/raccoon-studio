import { NextRequest, NextResponse } from 'next/server'
import { readPresets, upsertPreset, deletePreset } from '@/lib/prompts/store'

export async function GET() {
  return NextResponse.json({ presets: readPresets() })
}

export async function POST(req: NextRequest) {
  let body: { id?: string; name?: string; prompt?: string; negative?: string }
  try { body = (await req.json()) as typeof body } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const name = (body.name ?? '').trim()
  const prompt = (body.prompt ?? '').trim()
  if (!name || !prompt) return NextResponse.json({ error: 'name and prompt are required' }, { status: 400 })
  return NextResponse.json({ presets: upsertPreset({ id: body.id, name, prompt, negative: body.negative }) })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  return NextResponse.json({ presets: deletePreset(id) })
}
