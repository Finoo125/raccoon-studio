import { NextResponse } from 'next/server'
import path from 'path'
import { walk, type FileEntry } from '@/lib/models/on-disk'

export async function GET() {
  const modelsDir = process.env.COMFYUI_MODELS_DIR ?? null
  if (!modelsDir) return NextResponse.json({ modelsDir: null, total: { sizeBytes: 0, count: 0 }, subfolders: [] })

  const root = path.resolve(modelsDir)
  const flat: { rel: string; entry: FileEntry }[] = []
  walk(root, 6, flat, root)

  const groups = new Map<string, FileEntry[]>()
  for (const { rel, entry } of flat) {
    if (!groups.has(rel)) groups.set(rel, [])
    groups.get(rel)!.push(entry)
  }

  const subfolders = [...groups.entries()]
    .map(([subfolder, files]) => ({
      subfolder,
      files: files.sort((a, b) => b.sizeBytes - a.sizeBytes),
      count: files.length,
      sizeBytes: files.reduce((n, f) => n + f.sizeBytes, 0),
    }))
    .sort((a, b) => b.sizeBytes - a.sizeBytes)

  const total = {
    sizeBytes: subfolders.reduce((n, s) => n + s.sizeBytes, 0),
    count: subfolders.reduce((n, s) => n + s.count, 0),
  }

  return NextResponse.json({ modelsDir: root, total, subfolders })
}
