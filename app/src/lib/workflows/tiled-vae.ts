import type { ComfyUIPrompt } from '@/types/comfyui'
import type { GenerationParams } from '@/types/workflow'

/** ComfyUI's own VAEDecodeTiled default, and the size low-VRAM guides settle on
 *  for ~8 GB cards. */
const DEFAULT_TILE_SIZE = 512

/** ComfyUI's default overlap. The node itself clamps this to `tile_size / 4`
 *  when the tile is too small for it, so one value is safe at every tile size. */
const OVERLAP = 64

/** Video-VAE-only inputs. Required by the node signature even for image VAEs,
 *  where `temporal_compression_decode()` returns None and both are ignored.
 *  Omitting them fails validation rather than defaulting, so they must be sent. */
const TEMPORAL_SIZE = 64
const TEMPORAL_OVERLAP = 8

/**
 * Rewrites every VAEDecode in a finished graph to VAEDecodeTiled.
 *
 * Applied as one pass over the built workflow rather than inside each family
 * builder on purpose. A render can hold several decodes — the family's own, the
 * hires-fix pass, an img2img/outpaint branch — and the one that OOMs a small card
 * is usually the hires decode, because it runs at the upscaled size. Rewriting by
 * class_type catches all of them, and catches the ones a future family adds
 * without that family having to know this option exists.
 *
 * Mutates and returns `wf`: builders hand back a freshly constructed graph each
 * call, so there is nothing shared to protect.
 */
export function applyTiledVaeDecode(wf: ComfyUIPrompt, params: GenerationParams): ComfyUIPrompt {
  if (!params.tiledVaeDecode) return wf

  const tile_size = params.tiledVaeTileSize ?? DEFAULT_TILE_SIZE
  for (const node of Object.values(wf)) {
    if (node.class_type !== 'VAEDecode') continue
    node.class_type = 'VAEDecodeTiled'
    node.inputs = {
      ...node.inputs,
      tile_size,
      overlap: OVERLAP,
      temporal_size: TEMPORAL_SIZE,
      temporal_overlap: TEMPORAL_OVERLAP,
    }
  }
  return wf
}
