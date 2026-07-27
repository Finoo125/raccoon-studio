/**
 * The shared LoRA-family vocabulary, kept free of Node built-ins so client
 * components can import it. The detection that reads safetensors headers lives
 * in `lora-arch.ts`, which is server-only — importing that from a component
 * drags `fs` into the browser bundle and fails the build.
 */

/**
 * Families the app can generate with, plus the two it can only recognise well
 * enough to rule out (`sd15`, `flux` match no workflow, so they get filtered
 * out of every picker rather than offered and failing at validation).
 */
export type LoraFamily = 'sdxl' | 'zimage' | 'anima' | 'ernie' | 'ltx' | 'sd15' | 'flux'

/**
 * Narrow ComfyUI's LoRA list to the ones that can load on `family`.
 *
 * `names` come from ComfyUI (`/object_info`), `families` from
 * `/api/models/lora-arch`. ComfyUI reports subfolders with OS separators while
 * the API keys use '/', so names are normalised before lookup. Two deliberate
 * pass-throughs: an unrecognised LoRA (no entry, or null) stays listed rather
 * than silently vanishing, and a `selected` value is always kept so a live
 * selection never leaves the picker rendering blank.
 */
export function visibleLoras(
  names: string[],
  families: Record<string, LoraFamily | null>,
  family?: LoraFamily,
  selected?: string,
): string[] {
  if (!family) return names
  const kept = names.filter((n) => {
    const arch = families[n.replace(/\\/g, '/')]
    return !arch || arch === family
  })
  return selected && !kept.includes(selected) ? [selected, ...kept] : kept
}

/**
 * True when a picked LoRA is not among the ones ComfyUI actually reports.
 *
 * Selections survive reloads and arrive from gallery deep-links, so a name can
 * outlive the file — and ComfyUI rejects a name it can't resolve with
 * `value_not_in_list`, which surfaces as a raw "Generation failed". An empty
 * `installed` means the list never loaded (ComfyUI down), not that everything
 * vanished, so it never reports missing.
 */
export function loraIsMissing(selected: string, installed: string[]): boolean {
  return Boolean(selected) && installed.length > 0 && !installed.includes(selected)
}
