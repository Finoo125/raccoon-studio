import { NextRequest, NextResponse } from 'next/server'
import { assertEntitled } from '@/lib/addons/guard'
import { getComfyUIBase } from '@/lib/comfyui/server-state'
import { HELPER_LINK_ADDON } from '@/lib/generation/helper-handoff'
import { helperGraph } from '@/lib/generation/helper-render'
import { assetInstalled } from '@/lib/models/ltx23-assets'

/** The files ComfyUI lists for one loader input (what is installed); throws when ComfyUI cannot be asked. */
async function installed(base: string, node: string, input: string): Promise<Set<string>> {
  const d = await fetch(`${base}/object_info/${node}`, { cache: 'no-store' }).then((r) => r.json())
  return new Set((d?.[node]?.input?.required?.[input]?.[0] as string[] | undefined) ?? [])
}

/**
 * The video helper submits a clip render here instead of opening a Generate tab: the same validation as the
 * URL handoff, the harness's fixed form values, then straight into ComfyUI's queue (ComfyUI renders in order).
 * The proxy (proxy.ts) already limits /api to this machine; the add-on gate is the helper link's.
 */
export async function POST(req: NextRequest) {
  const locked = await assertEntitled(HELPER_LINK_ADDON)
  if (locked) return locked
  const built = helperGraph(await req.json().catch(() => null))
  if ('error' in built) return NextResponse.json({ error: built.error }, { status: 400 })
  const base = getComfyUIBase()
  try {
    const [unets, loras] = await Promise.all([installed(base, 'UNETLoader', 'unet_name'), installed(base, 'LoraLoaderModelOnly', 'lora_name')])
    const missing = [
      ...(assetInstalled(built.files.unet, unets) ? [] : [built.files.unet]),
      ...built.files.loras.filter((f) => !assetInstalled(f, loras)),
    ]
    if (missing.length) return NextResponse.json({ error: 'Not installed in ComfyUI', missing }, { status: 409 })
    const res = await fetch(`${base}/prompt`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: built.graph, client_id: 'video-helper' }),
    })
    const out = await res.json() as { prompt_id?: string; node_errors?: Record<string, unknown>; error?: unknown }
    if (!res.ok || !out.prompt_id || (out.node_errors && Object.keys(out.node_errors).length)) {
      return NextResponse.json({ error: 'ComfyUI refused the graph', detail: out }, { status: 502 })
    }
    return NextResponse.json({ promptId: out.prompt_id, seed: built.seed })
  } catch (e) {
    return NextResponse.json({ error: `ComfyUI is not reachable: ${(e as Error).message}` }, { status: 502 })
  }
}
