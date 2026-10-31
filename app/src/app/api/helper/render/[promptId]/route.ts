import { NextRequest, NextResponse } from 'next/server'
import { assertEntitled } from '@/lib/addons/guard'
import { getComfyUIBase } from '@/lib/comfyui/server-state'
import { HELPER_LINK_ADDON } from '@/lib/generation/helper-handoff'
import { renderStatus, type HistoryEntry } from '@/lib/generation/helper-render'

/** Where one helper render stands: queued, running, done (with its files under ComfyUI's output folder) or error. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ promptId: string }> }) {
  const locked = await assertEntitled(HELPER_LINK_ADDON)
  if (locked) return locked
  const { promptId } = await ctx.params
  const base = getComfyUIBase()
  const get = (path: string) => fetch(`${base}${path}`, { cache: 'no-store' }).then((r) => r.json())
  try {
    const hist = await get(`/history/${encodeURIComponent(promptId)}`) as Record<string, HistoryEntry>
    // A job ComfyUI is still running has no history yet; it reads as queued (the helper only waits for done/error).
    const queue = hist[promptId] ? null : await get('/queue') as { queue_running?: unknown[][]; queue_pending?: unknown[][] }
    const queued = !!queue && [...(queue.queue_running ?? []), ...(queue.queue_pending ?? [])].some((q) => q[1] === promptId)
    const s = renderStatus(hist[promptId], queued)
    return NextResponse.json(s, { status: s.status === 'unknown' ? 404 : 200 })
  } catch (e) {
    return NextResponse.json({ error: `ComfyUI is not reachable: ${(e as Error).message}` }, { status: 502 })
  }
}
