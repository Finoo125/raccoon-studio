import { NextRequest, NextResponse } from 'next/server'
import { loadRun, saveRun } from '@/lib/director/runs'
import { applyStoryboard } from '@/lib/director/run-doc'
import { buildStoryboardMessages, chatStoryboard, parseStoryboard } from '@/lib/director/ollama'
import { assertEntitled } from '@/lib/addons/guard'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Ctx) {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  const { id } = await params
  const run = loadRun(id)
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!run.ollamaModel) {
    return NextResponse.json({ error: 'No Ollama model selected' }, { status: 400 })
  }

  const messages = buildStoryboardMessages(run.plot, run.beatCount, run.imageModel)

  let lastRaw = ''
  // One retry on parse failure (model occasionally wraps/garbles JSON).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      lastRaw = await chatStoryboard(run.ollamaModel, messages)
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Ollama request failed' },
        { status: 502 },
      )
    }
    try {
      const parsed = parseStoryboard(lastRaw)
      const saved = saveRun(applyStoryboard(run, parsed))
      return NextResponse.json({ run: saved })
    } catch {
      // fall through to retry / final error
    }
  }

  return NextResponse.json(
    { error: 'Could not parse the storyboard JSON', raw: lastRaw },
    { status: 422 },
  )
}
