import type { OutputImage } from '@/types/comfyui'

export interface ResolvedOutputMedia {
  /** Proxy view URLs for the produced media, in output order. */
  urls: string[]
  /** True when the output came from VHS `gifs` (a video) rather than `images`. */
  isVideo: boolean
}

function viewUrl(item: OutputImage): string {
  return `/api/comfyui/view?filename=${encodeURIComponent(item.filename)}&subfolder=${encodeURIComponent(item.subfolder)}&type=${item.type}`
}

/**
 * Resolve an `executed` message's output into view URLs. VHS_VideoCombine reports
 * its mp4 under `gifs` (not `images`), so video takes precedence when both exist.
 *
 * Only saved (`type: "output"`) media is returned. Workflows emit `temp` previews
 * from non-saving nodes (a PreviewImage, or LTX's low-res first-pass
 * VHS_VideoCombine) that must not be mistaken for the finished result.
 */
export function resolveOutputMedia(
  output: { images?: OutputImage[]; gifs?: OutputImage[] } | undefined,
): ResolvedOutputMedia {
  const saved = (items: OutputImage[] | undefined) =>
    (items ?? []).filter((i) => i.type === 'output')

  const gifs = saved(output?.gifs)
  if (gifs.length > 0) {
    return { urls: gifs.map(viewUrl), isVideo: true }
  }
  return { urls: saved(output?.images).map(viewUrl), isVideo: false }
}

/**
 * The LTX first-pass motion preview, or null.
 *
 * The graph samples a half-size clip and writes it through a VideoCombine with
 * `save_output: false`, so it lands in ComfyUI's temp dir well before the
 * expensive upscale pass finishes. Watching it is how bad motion gets caught and
 * cancelled early — the upscale pass restores detail but will not fix motion.
 *
 * Only `gifs` count: a video job also emits a temp *image* (the PreviewImage of
 * the i2v source frame), which is not a preview of anything.
 */
export function resolveInterimVideo(
  output: { images?: OutputImage[]; gifs?: OutputImage[] } | undefined,
): string | null {
  const temp = (output?.gifs ?? []).filter((i) => i.type === 'temp')
  return temp.length > 0 ? viewUrl(temp[0]) : null
}
