import { NextRequest, NextResponse } from 'next/server'
import { createRun, listRuns } from '@/lib/director/runs'
import type { DirectorImageModel } from '@/types/director'
import { assertEntitled } from '@/lib/addons/guard'

export async function GET() {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  return NextResponse.json({ runs: listRuns() })
}

export async function POST(req: NextRequest) {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    plot?: string
    imageModel?: DirectorImageModel
    ollamaModel?: string
    targetSeconds?: number
  }
  const imageModel: DirectorImageModel =
    body.imageModel === 'z-image-turbo' ? 'z-image-turbo' : 'anima'
  const run = createRun({
    name: body.name ?? '',
    plot: body.plot ?? '',
    imageModel,
    ollamaModel: body.ollamaModel ?? '',
    targetSeconds: typeof body.targetSeconds === 'number' ? body.targetSeconds : 90,
  })
  return NextResponse.json({ run }, { status: 201 })
}
