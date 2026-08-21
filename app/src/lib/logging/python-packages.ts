import fs from 'fs'
import path from 'path'

/**
 * Package versions from ComfyUI's venv, read straight off the `*.dist-info`
 * directory names.
 *
 * No `pip list` subprocess: pip takes seconds to start, and a support bundle
 * must not hang because the venv happens to be mid-install.
 *
 * Why a bundle needs this at all: `installer/pinned-versions.txt` pins git
 * revisions of ComfyUI and the node packs — it does **not** pin pip packages —
 * so a fresh install takes whatever the index served that day. A live pod hit
 * `MistralConverter.__init__() missing 1 required positional argument:
 * 'vocab_file'` loading Ernie's text encoder, which is a `transformers`
 * signature mismatch, and the single number needed to diagnose it could not be
 * recovered from a user's bundle.
 */
export function pythonPackages(comfyUIDir: string | null): string[] {
  if (!comfyUIDir) return []
  const venv = path.join(comfyUIDir, '.venv')
  // Windows venvs use Lib/site-packages; POSIX nests under lib/pythonX.Y.
  const roots = [path.join(venv, 'Lib', 'site-packages')]
  try {
    const lib = path.join(venv, 'lib')
    for (const d of fs.readdirSync(lib)) roots.push(path.join(lib, d, 'site-packages'))
  } catch { /* no posix lib dir */ }

  for (const root of roots) {
    let entries: string[]
    try { entries = fs.readdirSync(root) } catch { continue }
    const pkgs = entries
      .filter((e) => e.endsWith('.dist-info'))
      .map((e) => {
        const stem = e.slice(0, -'.dist-info'.length)
        // `name-1.2.3.dist-info` — the version is after the LAST dash, because
        // package names legitimately contain dashes (comfyui-frontend-package).
        const dash = stem.lastIndexOf('-')
        return dash > 0 ? `${stem.slice(0, dash)}==${stem.slice(dash + 1)}` : stem
      })
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    if (pkgs.length) return pkgs
  }
  return []
}
