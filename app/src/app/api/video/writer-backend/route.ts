import { NextResponse } from 'next/server'
import { writerErrorMessage } from '@/lib/ai-writers/errors'
import { currentLmsPort } from '@/lib/ai-writers/lmstudio'
import { nodeBackend } from '@/lib/ai-writers/node-backend'
import { ensureRunning } from '@/lib/ai-writers/start'
import { serverAddress } from '@/lib/ai-writers/write'
import { parseWriterId } from '@/lib/ai-writers/writer-id'
import { getComfyUIBase } from '@/lib/comfyui/server-state'
import { migrateWriterId } from '@/lib/prompt-builder/video-picks'
import { getSettings } from '@/lib/settings/settings'

const fail = (error: string, status: number) => NextResponse.json({ error }, { status })

/** Starts the picked writer's app if it is off, then points the video node at it. */
export async function POST(req: Request) {
  const body = ((await req.json().catch(() => null)) ?? {}) as { engine?: string }
  // A bare Ollama model name (a form saved before writer ids) still means Ollama.
  const ref = parseWriterId(migrateWriterId(body.engine ?? ''))
  if (!ref) return fail('Pick a writer first.', 400)

  const { ollamaBaseUrl, aiServers } = getSettings()
  const address = ref.kind === 'server' ? serverAddress(ref.server, aiServers) ?? undefined : undefined
  const backend = nodeBackend(ref, { ollamaBaseUrl, lmsPort: currentLmsPort(), serverAddress: (id) => serverAddress(id, aiServers) })
  if (!backend) {
    return fail(ref.kind === 'builtin'
      ? 'The built-in writer can’t write video scripts. Pick another writer.'
      : 'That AI server isn’t in the list any more. Scan again.', 400)
  }

  try {
    await ensureRunning(ref)
  } catch (err) {
    return fail(writerErrorMessage(err, ref, address), 502)
  }
  try {
    const res = await fetch(`${getComfyUIBase()}/rvn/set_backend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backend),
    })
    if (!res.ok) return fail(`The video engine wouldn’t switch writers (HTTP ${res.status}).`, 502)
  } catch {
    return fail('The video engine isn’t answering. Start it and try again.', 502)
  }
  return NextResponse.json({ ok: true })
}
