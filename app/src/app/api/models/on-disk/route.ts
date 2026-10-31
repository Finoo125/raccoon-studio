import { NextResponse } from 'next/server'
import { getSettings } from '@/lib/settings/settings'
import { modelsOnDisk } from '@/lib/models/on-disk'
import { getComfyUIDir } from '@/lib/comfyui/server-state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(modelsOnDisk(process.env.COMFYUI_MODELS_DIR ?? '', getSettings().sharedModelsDir, getComfyUIDir()))
}
