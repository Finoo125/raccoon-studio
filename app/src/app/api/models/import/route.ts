import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

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

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const subfolder = formData.get('subfolder')
  const file = formData.get('file')

  if (typeof subfolder !== 'string' || !ALLOWED_SUBFOLDERS.includes(subfolder)) {
    return NextResponse.json({ error: 'Invalid subfolder' }, { status: 400 })
  }
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const filename = (file as File).name
  const ext = path.extname(filename).toLowerCase()
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json({ error: `File type ${ext} not allowed` }, { status: 400 })
  }
  // Prevent path traversal
  const safeName = path.basename(filename)

  const destDir = path.join(modelsDir, subfolder)
  const destPath = path.join(destDir, safeName)

  const existed = fs.existsSync(destPath)
  try {
    fs.mkdirSync(destDir, { recursive: true })
    // Stream the upload to disk instead of buffering the whole file: model files
    // are multi-GB and Buffer.from(arrayBuffer()) both blows past Node's buffer
    // limit and holds the entire file in memory.
    await pipeline(
      Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]),
      fs.createWriteStream(destPath),
    )
  } catch (e) {
    // Don't leave a partial/empty file behind that masquerades as a real model.
    fs.rmSync(destPath, { force: true })
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }

  // Verify the written file is complete. An empty or truncated write (e.g. a
  // body-size limit silently dropping the payload) would otherwise be reported
  // as a successful import and then fail to load at generation time.
  const written = fs.statSync(destPath).size
  if (written === 0 || (file.size > 0 && written !== file.size)) {
    fs.rmSync(destPath, { force: true })
    return NextResponse.json(
      {
        error: `Import incomplete: wrote ${written} of ${file.size} bytes. For large local models use "Import file" / "Import from path" instead of a browser upload.`,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, path: destPath, replaced: existed })
}
