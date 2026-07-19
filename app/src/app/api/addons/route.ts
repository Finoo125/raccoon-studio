import { NextResponse } from 'next/server'
import { addonFeatures } from '@/lib/features/registry'
import { getUnlockedFeatures, installKey } from '@/lib/addons/entitlement'

export async function GET() {
  const unlocked = await getUnlockedFeatures()
  const set = new Set(unlocked)
  const addons = addonFeatures().map((f) => ({
    id: f.id,
    label: f.label,
    href: f.href,
    requires: f.requires ?? null,
    unlocked: set.has(f.id),
  }))
  return NextResponse.json({ unlocked, addons })
}

export async function POST(req: Request) {
  let key = ''
  try {
    const body = await req.json()
    key = typeof body?.key === 'string' ? body.key : ''
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 })
  }
  const result = await installKey(key)
  if (!result.ok) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
