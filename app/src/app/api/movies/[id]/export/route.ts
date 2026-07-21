import { NextRequest, NextResponse } from 'next/server'
import { loadProject } from '@/lib/movies/projects'
import { getExportJob, startExport } from '@/lib/movies/export-job'
import { assertEntitled } from '@/lib/addons/guard'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Ctx) {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  const { id } = await params
  const project = loadProject(id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await req.json().catch(() => ({}))) as {
    settings?: { width: number; height: number; fps: number; filename: string }
  }
  const settings = body.settings ?? { ...project.settings, filename: project.name }
  try {
    return NextResponse.json({ job: startExport(project, settings) }, { status: 202 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 })
  }
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  const { id } = await params
  return NextResponse.json({ job: getExportJob(id) })
}
