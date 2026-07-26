import fs from 'fs'
import path from 'path'
import { getProjectRoot } from '@/lib/system/paths'

export interface Pin {
  name: string
  sha: string
}

/**
 * A pin is only usable if it is a full 40-char hex sha.
 *
 * Two reasons, and both have teeth. A short sha is accepted by `git checkout`
 * as a prefix (or as an unrelated ref that happens to match), which quietly
 * defeats the pin. And a value starting with `-` would reach `git` as a flag
 * rather than a revision — we never run these through a shell, so there is no
 * injection risk, but arbitrary git flags are their own problem.
 */
const FULL_SHA = /^[0-9a-f]{40}$/

/**
 * Parse the contents of `installer/pinned-versions.txt` — the single manifest
 * both installers read, so the app can converge an install onto the same set.
 *
 * Format is `<name> <sha>`; blank lines and `#` comments are ignored, and a
 * name with no sha is "unpinned" (the installers follow the default branch for
 * those, so there is nothing for us to apply).
 *
 * The manifest gets edited on Windows, so lines arrive with a trailing `\r`.
 * Trimming each line is what keeps that off the end of the sha — a `\r` there
 * makes every `git checkout` silently match nothing, and the pins look applied
 * when they are not. The PowerShell reader hit exactly this bug (afe02a9).
 */
export function parsePins(text: string): Pin[] {
  return text.split('\n').flatMap((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return []
    const [name, sha] = trimmed.split(/\s+/)
    return sha && FULL_SHA.test(sha) ? [{ name, sha }] : []
  })
}

/** Read the manifest from a project root; an unreadable manifest yields no pins. */
export function readPins(root: string = getProjectRoot()): Pin[] {
  try {
    return parsePins(fs.readFileSync(path.join(root, 'installer', 'pinned-versions.txt'), 'utf8'))
  } catch {
    return []
  }
}

/**
 * Directory a pin applies to. `ComfyUI` means the install root itself; every
 * other name is a `custom_nodes` directory, as the manifest header specifies.
 */
export function pinDir(name: string, comfyuiDir: string): string {
  return name === 'ComfyUI' ? comfyuiDir : path.join(comfyuiDir, 'custom_nodes', name)
}
