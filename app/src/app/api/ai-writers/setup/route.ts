import { NextRequest, NextResponse } from 'next/server'
import { realSetupDeps } from '@/lib/ai-writers/setup-deps'
import { listSetups, startSetup, type SetupRequest } from '@/lib/ai-writers/setup-jobs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Every setup in flight (and recently finished), for the dialog's step list. */
export async function GET() {
  return NextResponse.json({ jobs: listSetups() })
}

/** "Set up the built-in writer" / "Set up Ollama for me": starts (or joins) the job and answers at once. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { kind?: string; model?: string }
  const request: SetupRequest | null = body.kind === 'builtin' ? { kind: 'builtin' }
    : body.kind === 'ollama' && body.model ? { kind: 'ollama', model: body.model } : null
  if (!request) return NextResponse.json({ error: 'Unknown setup' }, { status: 400 })
  const out = startSetup(request, realSetupDeps())
  return 'error' in out && !('steps' in out) ? NextResponse.json(out, { status: 400 }) : NextResponse.json({ job: out })
}
