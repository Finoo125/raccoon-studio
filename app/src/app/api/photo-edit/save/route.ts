import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { assertEntitled } from '@/lib/addons/guard'

const OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR ?? ''

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
  const buf = Buffer.from(await file.arrayBuffer())

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
