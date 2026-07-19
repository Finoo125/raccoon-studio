import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const ALLOWED_SUBFOLDERS = [
  'diffusion_models', 'text_encoders', 'vae', 'loras', 'checkpoints',
  'ultralytics/bbox', 'sams',
]
const ALLOWED_EXTENSIONS = ['.safetensors', '.ckpt', '.pt', '.bin', '.gguf', '.pth']

export async function POST(req: NextRequest) {
  const modelsDir = process.env.COMFYUI_MODELS_DIR ?? ''
  if (!modelsDir) {
    return NextResponse.json({ error: 'COMFYUI_MODELS_DIR is not configured' }, { status: 500 })
  }

  let body: { sourcePath?: string; subfolder?: string }
  try {
    body = await req.json() as { sourcePath?: string; subfolder?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { sourcePath, subfolder } = body

  if (!sourcePath || typeof sourcePath !== 'string') {
    return NextResponse.json({ error: 'sourcePath is required' }, { status: 400 })
  }
  if (typeof subfolder !== 'string' || !ALLOWED_SUBFOLDERS.includes(subfolder)) {
    return NextResponse.json({ error: 'Invalid subfolder' }, { status: 400 })
  }

  const ext = path.extname(sourcePath).toLowerCase()
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json({ error: `File type ${ext} not allowed` }, { status: 400 })
  }

  if (!fs.existsSync(sourcePath)) {
    return NextResponse.json({ error: `File not found: ${sourcePath}` }, { status: 400 })
  }

  const filename = path.basename(sourcePath)
  // Prevent traversal via filename
  if (filename !== path.basename(filename) || filename.includes('..')) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
  }

  const destDir = path.join(modelsDir, subfolder)
  const destPath = path.join(destDir, filename)

  const sourceSize = fs.statSync(sourcePath).size
  const existed = fs.existsSync(destPath)
  try {
    fs.mkdirSync(destDir, { recursive: true })
    await fs.promises.copyFile(sourcePath, destPath)
  } catch (e) {
    // A copy that failed partway can leave a truncated/empty file behind; drop it
    // so it can't masquerade as a working model.
    if (!existed) fs.rmSync(destPath, { force: true })
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }

  // Guard against a silent short copy (interrupted transfer, full disk): an
  // empty/truncated model would import "successfully" then fail at load time.
  const written = fs.statSync(destPath).size
  if (written !== sourceSize) {
    if (!existed) fs.rmSync(destPath, { force: true })
    return NextResponse.json(
      { error: `Copy incomplete: ${written} of ${sourceSize} bytes (disk full or source unreadable?)` },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, path: destPath, replaced: existed, name: filename })
}
