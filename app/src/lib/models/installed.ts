type ObjInfo = Record<string, { input?: { required?: Record<string, [string[]]> } }> | null

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
  const names = (data: unknown, node: string, field: string): string[] =>
    (data as ObjInfo)?.[node]?.input?.required?.[field]?.[0] ?? []
  return (
    names(ckpt, 'CheckpointLoaderSimple', 'ckpt_name').length > 0 ||
    names(unet, 'UNETLoader', 'unet_name').length > 0
  )
}
