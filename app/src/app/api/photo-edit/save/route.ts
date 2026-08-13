import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { assertEntitled } from '@/lib/addons/guard'
import { injectPngTextChunks, parsePngTextChunks } from '@/lib/gallery/metadata'

const OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR ?? ''

/** Text chunks sit before IDAT, so a 1 MB prefix is enough to read them all. */
const HEADER_BYTES = 1024 * 1024

/**
 * Carry the source image's generation recipe onto the edited bytes.
 *
 * The editor exports through `canvas.toBlob()`, which writes a PNG with no
 * ancillary chunks — so without this the gallery's prompt/seed/LoRA metadata is
 * silently lost on "save as copy" and *destroyed* on "overwrite original".
 *
 * ponytail: PNG only. JPEG would need an EXIF/XMP writer for the same trick, and
 * PNG is the default and the format every generated image already uses.
 */
function carryMetadata(edited: Buffer, originalPath: string | null): Buffer {
  if (!originalPath) return edited
  try {
    const fd = fs.openSync(originalPath, 'r')
    try {
      const len = Math.min(HEADER_BYTES, fs.fstatSync(fd).size)
      const head = Buffer.allocUnsafe(len)
      fs.readSync(fd, head, 0, len, 0)
      return injectPngTextChunks(edited, parsePngTextChunks(head))
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return edited // original gone, unreadable, or not a PNG — saving still wins
  }
}

export function resolveWithinRoot(root: string, subfolder: string, filename: string): string | null {
  const r = path.resolve(root)
  const fp = path.resolve(r, subfolder, filename)
  if (fp !== r && !fp.startsWith(r + path.sep)) return null
  return fp
}

export function nextCopyName(
  root: string,
  subfolder: string,
  original: string,
  ext: string,
  exists: (p: string) => boolean,
): string {
  const base = original.replace(/\.[^.]+$/, '')
  let name = `${base}_edited.${ext}`
  let n = 2
  while (exists(path.resolve(root, subfolder, name))) {
    name = `${base}_edited-${n}.${ext}`
    n++
  }
  return name
}

export async function POST(req: NextRequest) {
  const denied = await assertEntitled('photo-editor')
  if (denied) return denied
  if (!OUTPUT_DIR) {
    return NextResponse.json({ error: 'COMFYUI_OUTPUT_DIR not configured' }, { status: 500 })
  }
  const form = await req.formData()
  const file = form.get('file') as File | null
  const mode = (form.get('mode') as string) ?? 'copy'
  const subfolder = (form.get('subfolder') as string) ?? ''
  const filename = (form.get('filename') as string) ?? ''
  if (!file || !filename) {
    return NextResponse.json({ error: 'Missing file or filename' }, { status: 400 })
  }
  const ext = file.type === 'image/jpeg' ? 'jpg' : 'png'
  // The source image the edits came from — its text chunks ride along to the copy.
  // Only for gallery originals: an upload just happens to share a name with a
  // gallery file would otherwise be stamped with that file's unrelated recipe.
  const sourcePath =
    form.get('origin') === 'gallery' ? resolveWithinRoot(OUTPUT_DIR, subfolder, filename) : null
  const buf = carryMetadata(Buffer.from(await file.arrayBuffer()), sourcePath)

  if (mode === 'overwrite') {
    const target = resolveWithinRoot(OUTPUT_DIR, subfolder, filename)
    if (!target) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!fs.existsSync(target)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      await fs.promises.writeFile(target, buf)
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 })
    }
    return NextResponse.json({ filename, subfolder })
  }

  const name = nextCopyName(OUTPUT_DIR, subfolder, filename, ext, (p) => fs.existsSync(p))
  const target = resolveWithinRoot(OUTPUT_DIR, subfolder, name)
  if (!target) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    await fs.promises.writeFile(target, buf)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
  return NextResponse.json({ filename: name, subfolder })
}
