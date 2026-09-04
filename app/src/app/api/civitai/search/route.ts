import { NextRequest, NextResponse } from 'next/server'
import { assertEntitled } from '@/lib/addons/guard'
import { searchModels } from '@/lib/civitai/client'

/** Proxy so the token stays server-side and one entitlement check covers it. */
export async function GET(req: NextRequest) {
  const denied = await assertEntitled('civitai-browser')
  if (denied) return denied

  const q = req.nextUrl.searchParams
  try {
    return NextResponse.json(await searchModels({
      query: q.get('query') ?? undefined,
      types: q.get('types') ?? undefined,
      sort: q.get('sort') ?? undefined,
      baseModels: q.get('baseModels') ?? undefined,
      cursor: q.get('cursor') ?? undefined,
    }))
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Search failed' },
      { status: 502 },
    )
  }
}
