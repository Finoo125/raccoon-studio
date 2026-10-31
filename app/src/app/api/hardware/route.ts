import { NextResponse } from 'next/server'
import { getSettings } from '@/lib/settings/settings'
import { detectHardware } from '@/lib/hardware'

export const runtime = 'nodejs'
// Asked fresh every time: the answer is this machine's, never a build-time one.
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(await detectHardware(getSettings().comfyuiBaseUrl, process.env.COMFYUI_MODELS_DIR ?? ''))
}
