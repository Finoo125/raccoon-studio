import fs from 'node:fs'
import path from 'node:path'
import { hasForeignExtraModelPaths, resolveSharedModelsDir } from '@/lib/comfyui/extra-model-paths'

// `.onnx` belongs here: the whole face-swap stack (inswapper, hyperswap
// 1a/1b/1c, GPEN-BFR-1024) is ONNX, and leaving it out made ~1.9 GB of models
// invisible to the Manage-models panel — unlistable, undeletable, and missing
// from the reported disk total. Found on a pod where those files ship inside
// the image, so the download route correctly reported "already exists" for
// files this scanner then claimed were not there.
const MODEL_EXT = /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i

export interface FileEntry { name: string; path: string; sizeBytes: number; mtime: string }

const isLinkedDir = (p: string) => {
  try { return fs.statSync(p).isDirectory() } catch { return false }
}

/**
 * `followLinks`: walk a linked folder (symlink, or a junction on Windows) like
 * a real one — moving models to a bigger disk and linking them back is common;
 * the depth cap bounds a link loop. Opt-in: the Models page's disk usage would
 * list a folder linked inside the tree twice.
 */
export function walk(dir: string, depth: number, out: { rel: string; entry: FileEntry }[], root: string, followLinks = false): void {
  if (depth < 0) return
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory() || (followLinks && e.isSymbolicLink() && isLinkedDir(p))) walk(p, depth - 1, out, root, followLinks)
    else if (MODEL_EXT.test(e.name)) {
      try {
        const stat = fs.statSync(p)
        const rel = path.relative(root, path.dirname(p)) || '.'
        out.push({ rel, entry: { name: e.name, path: p, sizeBytes: stat.size, mtime: stat.mtime.toISOString() } })
      } catch { /* skip unreadable */ }
    }
  }
}

/** What the start page and the first-start setup need to know about the model folders. */
export interface ModelsOnDisk {
  /**
   * False when nothing can be said, so nobody is sent to the setup and nothing
   * reads as missing: COMFYUI_MODELS_DIR is unset, or a hand-written
   * extra_model_paths.yaml has ComfyUI load folders this scan cannot see.
   */
  known: boolean
  /** Every model file's name (names are distinctive; the folder is not compared). */
  files: string[]
  /** A checkpoint or diffusion model exists, i.e. this install can already make pictures. */
  hasImageModel: boolean
}

const IMAGE_FOLDERS = ['checkpoints', 'diffusion_models', 'unet']

/**
 * Scans the models folder and the shared one — resolved exactly as the
 * generated extra_model_paths.yaml points ComfyUI at it, so a shared ComfyUI
 * install is read through its `models/` folder, never its custom_nodes or venv.
 * `comfyDir` (getComfyUIDir) is where a hand-written config would sit.
 */
export function modelsOnDisk(modelsDir: string, sharedModelsDir: string, comfyDir?: string | null): ModelsOnDisk {
  if (!modelsDir || (comfyDir && hasForeignExtraModelPaths(comfyDir))) return { known: false, files: [], hasImageModel: false }
  const roots = [modelsDir, sharedModelsDir && resolveSharedModelsDir(sharedModelsDir)]
    .filter((r): r is string => Boolean(r))
    .map((r) => path.resolve(r))
  const found: { rel: string; entry: FileEntry }[] = []
  for (const root of new Set(roots)) if (fs.existsSync(root)) walk(root, 6, found, root, true)
  return {
    known: true,
    files: [...new Set(found.map((f) => f.entry.name))],
    hasImageModel: found.some((f) => IMAGE_FOLDERS.includes(f.rel.split(/[\\/]/)[0])),
  }
}
