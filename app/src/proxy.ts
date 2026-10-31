import { NextResponse, type NextRequest } from 'next/server'
import { guard } from '@/lib/system/request-guard'

/** /api answers only the studio's own pages — see lib/system/request-guard.ts. */
export function proxy(req: NextRequest) {
  return guard(req) ?? NextResponse.next()
}

// Next buffers the body of every request a proxy matches and cuts it at 10 MB
// (proxyClientMaxBodySize), so routes that take uploads — model files, backups,
// clips through the ComfyUI proxy — are skipped here and call guard() themselves.
export const config = {
  matcher: '/api/((?!comfyui/|backup/upload|models/import|movies/import|movies/[^/]+/import|photo-edit/save|video/describe).*)',
}
