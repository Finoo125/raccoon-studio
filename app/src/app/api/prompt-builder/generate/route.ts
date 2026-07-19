import { NextResponse } from 'next/server'
import { assertEntitled } from '@/lib/addons/guard'
import { buildMessages, type PromptTask } from '@/lib/prompt-builder/enhance'
import { chatText } from '@/lib/director/ollama'
import type { PromptMode } from '@/lib/prompt-builder/templates'

export async function POST(req: Request) {
  const denied = await assertEntitled('prompt-builder')
  if (denied) return denied

  const body = (await req.json().catch(() => null)) as
    | { mode?: PromptMode; task?: PromptTask; input?: string; model?: string }
    | null

  const mode = body?.mode
  const task = body?.task
  const input = body?.input?.trim() ?? ''
  const model = body?.model?.trim() ?? ''

  if ((mode !== 'photoreal' && mode !== 'anime') || (task !== 'enhance' && task !== 'generate')) {
    return NextResponse.json({ error: 'Invalid mode or task' }, { status: 400 })
  }
  if (!input) return NextResponse.json({ error: 'Input is required' }, { status: 400 })
  if (!model) return NextResponse.json({ error: 'Select an Ollama model' }, { status: 400 })

  try {
    const prompt = await chatText(model, buildMessages(mode, task, input))
    if (!prompt) return NextResponse.json({ error: 'Model returned no text' }, { status: 502 })
    return NextResponse.json({ prompt })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ollama request failed' },
      { status: 502 },
    )
  }
}
