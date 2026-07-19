import { NextRequest, NextResponse } from 'next/server'
import { getGalleryRaw, applyFilters } from '@/lib/gallery/scanner'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const refresh = sp.get('refresh') === 'true'

  const media = sp.get('media') === 'video' ? 'video' : 'image'
  const raw = getGalleryRaw(refresh)
  const images = applyFilters(raw.images, {
    media,
    workflow: sp.get('workflow') ?? undefined,
    search: sp.get('search') ?? undefined,
    favoritesOnly: sp.get('favorites') === 'true',
    dateFrom: sp.get('dateFrom') ?? undefined,
    dateTo: sp.get('dateTo') ?? undefined,
    sortBy: (sp.get('sort') as 'newest' | 'oldest' | 'name' | 'largest' | 'random') ?? 'newest',
    tag: sp.get('tag') ?? undefined,
    model: sp.get('model') ?? undefined,
    sampler: sp.get('sampler') ?? undefined,
    dimensions: sp.get('dimensions') ?? undefined,
  })

  return NextResponse.json({
    images,
    total: raw.images.filter((i) => (i.media ?? 'image') === media).length,
    scannedAt: raw.scannedAt,
    imagesDir: raw.imagesDir,
    cached: raw.cached,
  })
}
