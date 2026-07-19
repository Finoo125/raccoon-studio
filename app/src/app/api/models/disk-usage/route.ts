import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const MODEL_EXT = /\.(safetensors|ckpt|pt|pth|bin|gguf)$/i

interface FileEntry { name: string; path: string; sizeBytes: number; mtime: string }

function walk(dir: string, depth: number, out: { rel: string; entry: FileEntry }[], root: string): void {
  if (depth < 0) return
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, depth - 1, out, root)
    else if (MODEL_EXT.test(e.name)) {
      try {
        const stat = fs.statSync(p)
        const rel = path.relative(root, path.dirname(p)) || '.'
        out.push({ rel, entry: { name: e.name, path: p, sizeBytes: stat.size, mtime: stat.mtime.toISOString() } })
      } catch { /* skip unreadable */ }
    }
  }
}

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
