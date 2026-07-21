import { NextRequest, NextResponse } from 'next/server'
import { loadProject } from '@/lib/movies/projects'
import { buildBundle, BUNDLE_EXTENSION } from '@/lib/movies/bundle'
import { assertEntitled } from '@/lib/addons/guard'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  const { id } = await params
  const project = loadProject(id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const includeMedia = req.nextUrl.searchParams.get('media') !== '0'
  const buffer = buildBundle(project, includeMedia)
  const base = project.name.replace(/[^\w.\-()\s]/g, '_').trim() || 'movie-project'
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(buffer.length),
      'Content-Disposition': `attachment; filename="${base}${BUNDLE_EXTENSION}"`,
    },
  })
}
