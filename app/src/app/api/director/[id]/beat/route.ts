import { NextRequest, NextResponse } from 'next/server'
import { loadRun, saveRun } from '@/lib/director/runs'
import { markBeatRendering, markBeatDone, markBeatError, resetBeat } from '@/lib/director/run-doc'
import type { DirectorRun } from '@/types/director'
import { assertEntitled } from '@/lib/addons/guard'

type Ctx = { params: Promise<{ id: string }> }

type Body =
  | { action: 'rendering'; index: number; promptId: string; seedImageFilename: string }
  | { action: 'done'; index: number; videoUrl: string; lastFrameInputFilename: string; videoPath?: string }
  | { action: 'error'; index: number; error: string }
  | { action: 'reset'; index: number }

export async function POST(req: NextRequest, { params }: Ctx) {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  const { id } = await params
  const run = loadRun(id)
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = (await req.json().catch(() => null)) as Body | null
  if (!body || typeof body.index !== 'number') {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  if (body.index < 0 || body.index >= run.beats.length) {
    return NextResponse.json({ error: 'Beat index out of range' }, { status: 400 })
  }

  let next: DirectorRun
  switch (body.action) {
    case 'rendering':
      next = markBeatRendering(run, body.index, {
        promptId: body.promptId,
        seedImageFilename: body.seedImageFilename,
      })
      break
    case 'done':
      next = markBeatDone(run, body.index, {
        videoUrl: body.videoUrl,
        lastFrameInputFilename: body.lastFrameInputFilename,
        videoPath: body.videoPath,
      })
      break
    case 'error':
      next = markBeatError(run, body.index, body.error)
      break
    case 'reset':
      next = resetBeat(run, body.index)
      break
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  return NextResponse.json({ run: saveRun(next) })
}
