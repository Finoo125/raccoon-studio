import { NextRequest, NextResponse } from 'next/server'
import { startApp } from '@/lib/ai-writers/start'

export const runtime = 'nodejs'

/** "Start Ollama" / "Start LM Studio": starts the switched-off app and answers once it does (or plain words why not). */
export async function POST(req: NextRequest) {
  const { app } = (await req.json().catch(() => ({}))) as { app?: string }
  if (app !== 'ollama' && app !== 'lmstudio') return NextResponse.json({ error: 'Unknown app' }, { status: 400 })
  try {
    await startApp(app)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }
}
