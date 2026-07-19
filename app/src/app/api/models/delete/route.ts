import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function POST(req: NextRequest) {
  const modelsDir = process.env.COMFYUI_MODELS_DIR ?? ''
  if (!modelsDir) return NextResponse.json({ error: 'COMFYUI_MODELS_DIR not configured' }, { status: 500 })

  let target: string
  try {
    target = ((await req.json()) as { path?: string }).path ?? ''
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!target) return NextResponse.json({ error: 'Missing path' }, { status: 400 })

  const root = path.resolve(modelsDir)
  const filePath = path.resolve(target)
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  fs.unlinkSync(filePath)
  return NextResponse.json({ ok: true })
}
