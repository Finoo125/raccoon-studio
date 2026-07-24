import { NextRequest, NextResponse } from 'next/server'
import { getSettings, setSettings, type AppSettings } from '@/lib/settings/settings'
import { getLogsDir } from '@/lib/system/paths'
import { getComfyUIDir } from '@/lib/comfyui/server-state'
import { syncExtraModelPaths } from '@/lib/comfyui/extra-model-paths'

export async function GET() {
  return NextResponse.json({
    settings: getSettings(),
    paths: {
      modelsDir: process.env.COMFYUI_MODELS_DIR ?? null,
      outputDir: process.env.COMFYUI_OUTPUT_DIR ?? null,
      logsDir: getLogsDir(),
      projectsDir: process.env.DIRECTOR_PROJECTS_DIR ?? null,
    },
  })
}

const isUrl = (v: unknown): v is string => {
  if (typeof v !== 'string') return false
  try { new URL(v); return true } catch { return false }
}
const isPosNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

export async function PUT(req: NextRequest) {
  let body: Partial<AppSettings>
  try {
    body = (await req.json()) as Partial<AppSettings>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const patch: Partial<AppSettings> = {}
  if ('ollamaBaseUrl' in body) {
    if (!isUrl(body.ollamaBaseUrl)) return NextResponse.json({ error: 'ollamaBaseUrl must be a URL' }, { status: 400 })
    patch.ollamaBaseUrl = body.ollamaBaseUrl
  }
  if ('comfyuiBaseUrl' in body) {
    if (!isUrl(body.comfyuiBaseUrl)) return NextResponse.json({ error: 'comfyuiBaseUrl must be a URL' }, { status: 400 })
    patch.comfyuiBaseUrl = body.comfyuiBaseUrl
  }
  if ('ollamaTimeoutMs' in body) {
    if (!isPosNum(body.ollamaTimeoutMs)) return NextResponse.json({ error: 'ollamaTimeoutMs must be a positive number' }, { status: 400 })
    patch.ollamaTimeoutMs = body.ollamaTimeoutMs
  }
  if ('ollamaNumCtx' in body) {
    if (!isPosNum(body.ollamaNumCtx)) return NextResponse.json({ error: 'ollamaNumCtx must be a positive number' }, { status: 400 })
    patch.ollamaNumCtx = body.ollamaNumCtx
  }
  if ('ffmpegPath' in body) {
    if (typeof body.ffmpegPath !== 'string') return NextResponse.json({ error: 'ffmpegPath must be a string' }, { status: 400 })
    patch.ffmpegPath = body.ffmpegPath.trim()
  }
  if ('sharedModelsDir' in body) {
    if (typeof body.sharedModelsDir !== 'string') return NextResponse.json({ error: 'sharedModelsDir must be a string' }, { status: 400 })
    const dir = body.sharedModelsDir.trim()
    const comfyDir = getComfyUIDir()
    if (dir && !comfyDir) return NextResponse.json({ error: 'ComfyUI directory unknown — set COMFYUI_DIR in .env.local' }, { status: 400 })
    // Write the config first: a bad path must fail the save, not persist a
    // setting that ComfyUI never picks up.
    try {
      if (comfyDir) syncExtraModelPaths(comfyDir, dir)
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not write extra_model_paths.yaml' }, { status: 400 })
    }
    patch.sharedModelsDir = dir
  }

  return NextResponse.json({ settings: setSettings(patch) })
}
