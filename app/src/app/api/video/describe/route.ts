import { NextResponse } from 'next/server'
import { guard } from '@/lib/system/request-guard'
import { getSettings } from '@/lib/settings/settings'
import { chatText } from '@/lib/director/ollama'
import { cleanDescription, describeQuestion } from '@/lib/video/describe'

/**
 * Describe one Edit picture (an input/ file ComfyUI serves) with an Ollama vision
 * model. The built-in describer runs in ComfyUI from the browser instead.
 */
export async function POST(req: Request) {
  const refused = guard(req)
  if (refused) return refused
  const b = (await req.json().catch(() => null)) as { filename?: unknown; role?: string | null; head?: boolean; model?: unknown } | null
  const parts = typeof b?.filename === 'string' ? b.filename.split(/[\\/]/) : null
  if (!b || !parts || typeof b.model !== 'string' || !b.model || parts.some((p) => p === '..' || p === '')) {
    return NextResponse.json({ error: 'Need { filename, model, role? }' }, { status: 400 })
  }
  // ComfyUI's /view takes a basename plus its subfolder.
  const filename = parts.pop()!
  const subfolder = parts.join('/')
  try {
    const view = `${getSettings().comfyuiBaseUrl.replace(/\/$/, '')}/view?${new URLSearchParams({ filename, subfolder, type: 'input' })}`
    const pic = await fetch(view)
    if (!pic.ok) return NextResponse.json({ error: `ComfyUI could not serve ${b.filename as string}` }, { status: 404 })
    const image = Buffer.from(await pic.arrayBuffer()).toString('base64')
    // The user's own Ollama timeout (Settings): a cold 27B vision model needs minutes.
    const raw = await chatText(b.model, [{ role: 'user', content: describeQuestion(b.role ?? null, b.head === true), images: [image] }])
    return NextResponse.json({ text: cleanDescription(raw) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
