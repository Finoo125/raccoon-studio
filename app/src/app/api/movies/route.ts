import { NextRequest, NextResponse } from 'next/server'
import { createProject, listProjects } from '@/lib/movies/projects'
import { assertEntitled } from '@/lib/addons/guard'

export async function GET() {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  return NextResponse.json({ projects: listProjects() })
}

export async function POST(req: NextRequest) {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as { name?: string }
  const project = createProject(body.name ?? '')
  return NextResponse.json({ project }, { status: 201 })
}
