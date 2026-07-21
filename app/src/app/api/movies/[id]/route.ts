import { NextRequest, NextResponse } from 'next/server'
import type { MovieProject } from '@/types/movie'
import { deleteProject, loadProject, saveProject } from '@/lib/movies/projects'
import { assertEntitled } from '@/lib/addons/guard'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  const { id } = await params
  const project = loadProject(id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ project })
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  const { id } = await params
  if (!loadProject(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await req.json()) as { project?: MovieProject }
  if (!body.project || body.project.id !== id) {
    return NextResponse.json({ error: 'Project id mismatch' }, { status: 400 })
  }
  return NextResponse.json({ project: saveProject(body.project) })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  const { id } = await params
  deleteProject(id)
  return NextResponse.json({ ok: true })
}
