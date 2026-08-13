type ObjInfo = Record<string, { input?: { required?: Record<string, unknown> } }> | null

/**
 * The filenames a loader node offers for one of its combo inputs.
 *
 * ComfyUI serializes combo inputs two different ways, and a node can switch
 * from one to the other on any upstream update:
 *   - classic:  `[[...names], { ...config }]`
 *   - new schema API: `['COMBO', { options: [...names] }]`
 * Reading `[0]` blindly yields the *string* `'COMBO'` for the second form,
 * which spread into a Set becomes the characters C, O, M, B — matching no
 * filename, so a model that is present on disk reads as missing forever.
 * `LatentUpscaleModelLoader` and `UpscaleModelLoader` are already on the new
 * form; more migrate over time, so every read goes through here.
 */
export function comboOptions(data: unknown, node: string, field: string): string[] {
  const input = (data as ObjInfo)?.[node]?.input?.required?.[field]
  if (!Array.isArray(input)) return []
  const [head, config] = input as [unknown, unknown]
  if (Array.isArray(head)) return head as string[]
  return (config as { options?: string[] })?.options ?? []
}

/**
 * True when a remembered filename is one ComfyUI no longer offers.
 *
 * Every picker in the app persists a *name*, but the file it names can go away:
 * a reinstall re-populates `models/` while localStorage survives untouched, and
 * a family switch leaves behind a selection the new family never had. ComfyUI
 * then rejects the whole prompt with `value_not_in_list`, which reaches the user
 * as a bare "Generation failed" — and the picker that would clear it is usually
 * hidden precisely because the list is empty, so there is no way out from the UI.
 *
 * `loaded` is the part that is easy to get wrong. The lists start empty and fill
 * from /object_info, so "empty" alone cannot mean "gone" — that would wipe a
 * valid choice on every reload and whenever ComfyUI is down. But it cannot mean
 * "unavailable" either: an install with genuinely zero LoRAs (or zero face
 * models) reports an empty list, and that is exactly the case that strands a
 * stale name. Only a caller that knows ComfyUI answered can tell the two apart,
 * so it passes that in rather than inferring it from the list.
 */
export function selectionIsStale(
  selected: string | undefined,
  available: string[],
  loaded: boolean,
): boolean {
  return Boolean(selected) && loaded && !available.includes(selected as string)
}

/**
 * True when ComfyUI offers `file`. Names come back either bare or with a
 * subfolder prefix (`sdxl/foo.safetensors`, and on Windows with a backslash),
 * so the leaf is what gets compared.
 */
export function fileInstalled(file: string, available: string[]): boolean {
  return available.some((n) => n === file || n.replace(/\\/g, '/').endsWith('/' + file))
}

/**
 * Whether a model preset can actually generate right now.
 *
 * Usable means one of two things: its own base model is on disk, or the family
 * has an imported Aria model to run instead (the form's Model dropdown swaps the
 * loader wholesale, so an Aria model alone is enough — and it is the only *other*
 * checkpoint of that category the form can select).
 *
 * `loaded` is the guard that keeps a cold start honest: the lists fill from
 * /object_info, so before ComfyUI answers "empty" means "don't know yet", not
 * "nothing installed". Greying every preset out while ComfyUI boots — or
 * whenever it is offline — would look like a broken install, so until then
 * everything reads as available.
 */
export function presetAvailable(
  baseModel: string,
  installed: string[],
  ariaModels: string[],
  loaded: boolean,
): boolean {
  if (!loaded) return true
  return ariaModels.length > 0 || fileInstalled(baseModel, installed)
}

/**
 * True when ComfyUI reports at least one base model to generate with — an
 * SDXL-family checkpoint (CheckpointLoaderSimple) or a diffusion model
 * (UNETLoader, used by z-image/ernie/anima).
 *
 * Feed it only payloads from a *successful* /object_info call: an error body
 * (ComfyUI offline → the proxy answers 502) is indistinguishable from an empty
 * model list here.
 */
export function hasBaseModel(ckpt: unknown, unet: unknown): boolean {
  return (
    comboOptions(ckpt, 'CheckpointLoaderSimple', 'ckpt_name').length > 0 ||
    comboOptions(unet, 'UNETLoader', 'unet_name').length > 0
  )
}
