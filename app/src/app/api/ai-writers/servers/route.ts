import { NextRequest, NextResponse } from 'next/server'
import { addServer, type SavedServer } from '@/lib/ai-writers/openai-server'
import { getSettings, setSettings } from '@/lib/settings/settings'

export const runtime = 'nodejs'

const store = {
  list: () => getSettings().aiServers,
  save: (aiServers: SavedServer[]) => { setSettings({ aiServers }) },
}

/** "Add an address": probe it, and remember it only when it answers. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { address?: string; apiKey?: string }
  const out = await addServer(body.address ?? '', store, typeof body.apiKey === 'string' ? body.apiKey : '')
  // The key stays on the server: never echoed back.
  return 'error' in out ? NextResponse.json(out, { status: 422 }) : NextResponse.json({ server: { id: out.server.id, address: out.server.address } })
}

/** Forget an added server. */
export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { id?: string }
  store.save(store.list().filter((s) => s.id !== body.id))
  return NextResponse.json({ ok: true })
}
