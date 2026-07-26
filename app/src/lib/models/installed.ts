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
