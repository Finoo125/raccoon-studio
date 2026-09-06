import { NextResponse, type NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import { classifyLoraFile, classifyBaseFile, type LoraFamily } from '@/lib/models/lora-arch'

/**
 * Maps every installed model in one folder to the base-model family it belongs
 * to, so the pickers can drop the ones that can't load on the selected model.
 * Keys are the same names ComfyUI reports in `/object_info` (relative to that
 * folder), normalised to forward slashes — ComfyUI hands back OS separators, so
 * the client normalises before looking up.
 *
 * `?folder=` picks what to scan; it defaults to `loras`, which is all this route
 * did before the Model dropdown started filtering imported checkpoints the same
 * way. Adapters and base weights share no key naming, hence the two classifiers.
 *
 * Null means "unrecognised", and unrecognised files stay visible everywhere.
 */
const CLASSIFIERS = {
  loras: classifyLoraFile,
  checkpoints: classifyBaseFile,
  diffusion_models: classifyBaseFile,
} as const

/** file → family, keyed by size+mtime so an overwritten file re-reads itself.
 *  ponytail: in-memory, so it rebuilds on server restart — reading a few hundred
 *  headers costs well under a second. Persist to disk only if that stops being true. */
const cache = new Map<string, LoraFamily | null>()

function walk(
  dir: string,
  depth: number,
  root: string,
  out: Record<string, LoraFamily | null>,
  classify: (file: string) => LoraFamily | null,
): void {
  if (depth < 0) return
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }

  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) { walk(full, depth - 1, root, out, classify); continue }
    // Only safetensors carries a readable header; .ckpt/.pt are pickles and stay
    // unrecognised (and therefore visible).
    if (!e.name.toLowerCase().endsWith('.safetensors')) continue

    try {
      const stat = fs.statSync(full)
      const key = `${full}:${stat.size}:${stat.mtimeMs}`
      if (!cache.has(key)) cache.set(key, classify(full))
      out[path.relative(root, full).split(path.sep).join('/')] = cache.get(key) ?? null
    } catch { /* skip unreadable */ }
  }
}

export async function GET(req: NextRequest) {
  const folder = req.nextUrl.searchParams.get('folder') ?? 'loras'
  const classify = CLASSIFIERS[folder as keyof typeof CLASSIFIERS]
  const modelsDir = process.env.COMFYUI_MODELS_DIR
  if (!classify || !modelsDir) return NextResponse.json({ families: {} })

  const root = path.join(path.resolve(modelsDir), folder)
  const families: Record<string, LoraFamily | null> = {}
  walk(root, 4, root, families, classify)

  return NextResponse.json({ families })
}
