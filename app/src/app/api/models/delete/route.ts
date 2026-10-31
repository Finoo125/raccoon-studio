import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function POST(req: NextRequest) {
  const modelsDir = process.env.COMFYUI_MODELS_DIR ?? ''
  if (!modelsDir) return NextResponse.json({ error: 'COMFYUI_MODELS_DIR not configured' }, { status: 500 })

  let target: string
  try {
    const body = (await req.json()) as { path?: string; folder?: string; name?: string }
    // The disk scan reports names, not paths, so Simple Models' Remove sends folder + name.
    target = body.path ?? (body.folder && body.name ? path.join(modelsDir, body.folder, body.name) : '')
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
  try {
    fs.unlinkSync(filePath)
  } catch (e) {
    // Windows refuses while a process holds the file (ComfyUI with the model loaded): say so, the caller reports it.
    return NextResponse.json({ error: `Could not delete (in use?): ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
