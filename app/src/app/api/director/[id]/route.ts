import { NextRequest, NextResponse } from 'next/server'
import type { DirectorRun } from '@/types/director'
import { deleteRun, loadRun, saveRun } from '@/lib/director/runs'
import { assertEntitled } from '@/lib/addons/guard'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  const { id } = await params
  const run = loadRun(id)
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ run })
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  const { id } = await params
  const current = loadRun(id)
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await req.json()) as { run?: DirectorRun }
  if (!body.run || body.run.id !== id) {
    return NextResponse.json({ error: 'Run id mismatch' }, { status: 400 })
  }
  // Optimistic concurrency: reject a stale write so a background render writer's
  // beat updates are never clobbered by an out-of-date full-document save.
  if ((body.run.rev ?? 0) !== (current.rev ?? 0)) {
    return NextResponse.json(
      { error: 'Run changed since you loaded it — reload and retry', rev: current.rev },
      { status: 409 },
    )
  }
  return NextResponse.json({ run: saveRun(body.run) })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  const { id } = await params
  deleteRun(id)
  return NextResponse.json({ ok: true })
}
