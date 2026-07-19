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
